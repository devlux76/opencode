// End-to-end smoke test of the grounding plugin in a real OpenCode server, entirely on scratch:
// a throwaway server from this checkout on a random port, scratch XDG dirs (never the live
// 4096 server or its database), a fake Trailblazer and a fake OpenAI-compatible model that
// records what it is sent. Usage: bun run script/smoke.ts   (exits non-zero on any failure)
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const packageDir = path.resolve(import.meta.dir, "..")
const cliDir = path.resolve(import.meta.dir, "../../../cli")
const root = await mkdtemp(path.join(tmpdir(), "grounding-smoke-"))
const failures: string[] = []
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`)
  if (!ok) failures.push(what)
}

// Load the plugin exactly as opencode-update deploys it: package.json's `files` copied into a
// directory with no node_modules (the host loads a configured plugin from its package directory).
const pluginEntry = path.join(root, "plugin", "grounding")
await mkdir(pluginEntry, { recursive: true })
const manifest: { files: string[] } = await Bun.file(path.join(packageDir, "package.json")).json()
for (const file of manifest.files) await copyFile(path.join(packageDir, file), path.join(pluginEntry, file))

// A repository for the session to work in.
const repo = path.join(root, "repo")
await mkdir(repo)
await writeFile(path.join(repo, "a.ts"), "export function authDisabled() {\n  return true\n}\n")
for (const args of [["init", "-q"], ["add", "."], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "a"]])
  await Bun.spawn(["git", "-C", repo, ...args]).exited

// Fake Trailblazer: a fixed trail for any request.
const trailblazer = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: async (request) => {
    const op = new URL(request.url).pathname.slice(1)
    if (op === "trail")
      return Response.json({
        text: "a.ts:1-3\nexport function authDisabled() {",
        tokens: 10,
        notes: [],
        // As Trailblazer sends them (Trail.item/3): the node wrapped with its rank and form.
        items: [
          {
            node: {
              id: 1,
              kind: "function",
              qualified: "authDisabled",
              path: "a.ts",
              start_line: 1,
              end_line: 3,
              signature: "export function authDisabled() {",
              stale: false,
            },
            rank: 1,
            form: "full",
          },
        ],
      })
    return Response.json([])
  },
})
const stateDir = path.join(root, "trailblazer")
await mkdir(stateDir)
await writeFile(
  path.join(stateDir, "endpoint.json"),
  JSON.stringify({ url: `http://127.0.0.1:${trailblazer.port}`, token: "t" }),
)

// Fake model: records each request and answers with a short streamed text.
const requests: Array<{ messages: Array<{ role: string; content: unknown }>; tools?: Array<{ function: { name: string } }> }> = []
const model = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: async (request) => {
    requests.push(await request.json())
    const chunk = (delta: object, finish: string | null) =>
      `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    const body =
      chunk({ role: "assistant", content: "done, see a.ts:1-3 and gone.ts:1-2" }, null) +
      chunk({}, "stop") +
      `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n` +
      "data: [DONE]\n\n"
    return new Response(body, { headers: { "content-type": "text/event-stream" } })
  },
})

// Scratch config: the fake model as default, the plugin loaded from this checkout.
const xdg = Object.fromEntries(
  ["CONFIG", "DATA", "STATE", "CACHE"].map((name) => [`XDG_${name}_HOME`, path.join(root, name.toLowerCase())]),
)
await mkdir(path.join(xdg.XDG_CONFIG_HOME, "opencode"), { recursive: true })
await writeFile(
  path.join(xdg.XDG_CONFIG_HOME, "opencode", "opencode.json"),
  JSON.stringify({
    model: "fake/m",
    providers: {
      fake: {
        name: "Fake",
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: `http://127.0.0.1:${model.port}/v1`, apiKey: "x" },
        models: { m: { name: "M", capabilities: { tools: true } } },
      },
    },
    plugins: [{ package: pluginEntry, options: { endpointFile: path.join(stateDir, "endpoint.json") } }],
  }),
)

const port = 20_000 + Math.floor(Math.random() * 20_000)
if (port === 4096) throw new Error("refusing the live port")
const server = Bun.spawn(["bun", "run", "src/index.ts", "serve", "--port", String(port), "--hostname", "127.0.0.1"], {
  cwd: cliDir,
  env: { ...process.env, ...xdg, OPENCODE_SERVER_AUTH: "disabled", OPENCODE_PASSWORD: "", OPENCODE_SERVER_PASSWORD: "" },
  stdout: "ignore",
  stderr: Bun.file(path.join(root, "server.log")),
})
const base = `http://127.0.0.1:${port}`
const api = async (method: string, route: string, body?: unknown) => {
  const response = await fetch(base + route, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  return { status: response.status, json: text ? JSON.parse(text) : undefined }
}
const until = async (what: string, condition: () => Promise<boolean> | boolean, ms = 60_000) => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await Promise.resolve().then(condition).catch(() => false)) return true
    await Bun.sleep(250)
  }
  check(false, `timed out waiting for ${what}`)
  return false
}
const textOf = (content: unknown) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => (part && typeof part.text === "string" ? part.text : "")).join("")
      : ""
const blocks = (index: number) =>
  requests[index].messages.flatMap((message) => [...textOf(message.content).matchAll(/<trailblazer-grounding task="([^"]+)"/g)].map((m) => m[1]))

try {
  if (!(await until("the server", async () => (await fetch(`${base}/api/info`)).ok))) throw new Error("no server")
  const location = { location: { directory: repo } }

  const created = await api("POST", "/api/session", { title: "smoke", ...location })
  const sessionID: string = created.json.data.id
  await api("POST", `/api/session/${sessionID}/prompt`, { text: "fix `authDisabled` please", delivery: "queue" })
  await until("the first model request", () => requests.length >= 1)
  const plugins = await api("GET", `/api/plugin?location[directory]=${encodeURIComponent(repo)}`)
  const listed = JSON.stringify(plugins.json ?? "")
  check(listed.includes("local.grounding") || listed.includes(pluginEntry), "the plugin is listed for the repository")
  const toolNames = (requests[0].tools ?? []).map((tool) => tool.function.name)
  check(
    ["trailblazer_where", "trailblazer_uses", "trailblazer_impact", "trailblazer_read"].every((name) => toolNames.includes(name)),
    "the model is offered the four Trailblazer tools",
  )
  check(blocks(0).length === 1, `the first request carries exactly one grounding block (${blocks(0).length})`)
  check(
    requests[0].messages.some((message) => {
      const text = textOf(message.content)
      return text.includes('source="trail"') && text.includes("a.ts:1-3\nexport function authDisabled() {")
    }),
    "the block carries Trailblazer's trail (source=trail, not the degraded fallback)",
  )

  await until("the run to finish", async () => !JSON.stringify((await api("GET", "/api/session/active")).json).includes(sessionID))
  await Bun.sleep(1_000)
  check(requests.length === 1, `grounding cost no extra model turn (${requests.length} requests for one answer)`)
  await api("POST", `/api/session/${sessionID}/prompt`, { text: "now also handle `serverAuth`", delivery: "queue" })
  await until("the second model request", () => requests.length >= 2)
  const [first] = blocks(0)
  const second = blocks(1)
  check(second.length === 1 && second[0] !== first, `the second task carries only its own block (${second.join(", ")})`)
  const order = requests[1].messages.map((message) => textOf(message.content))
  check(
    order.findIndex((text) => text.startsWith("<trailblazer-grounding")) === order.indexOf("now also handle `serverAuth`") - 1,
    "the block sits just before the task's prompt",
  )
  const evidence = order.find((text) => text.startsWith("<trailblazer-evidence-check"))
  check(
    evidence !== undefined && evidence.includes("gone.ts:1-2: missing") && !evidence.includes("a.ts:1-3"),
    "the evidence check after the first run named only the missing citation",
  )
} finally {
  if (failures.length) {
    console.log("plugins:", JSON.stringify((await api("GET", `/api/plugin?location[directory]=${encodeURIComponent(repo)}`).catch(() => ({ json: null }))).json).slice(0, 600))
    console.log("tools offered:", JSON.stringify(requests.map((r) => (r.tools ?? []).map((t) => t.function.name))))
    console.log("blocks per request:", JSON.stringify(requests.map((_, i) => blocks(i))))
    console.log("roles per request:", JSON.stringify(requests.map((r) => r.messages.map((m) => `${m.role}:${textOf(m.content).slice(0, 30)}`))))
  }
  server.kill()
  await server.exited
  trailblazer.stop(true)
  model.stop(true)
  if (failures.length === 0) await rm(root, { recursive: true, force: true })
  else console.log(`kept ${root} for inspection (server.log there)`)
}
console.log(failures.length === 0 ? "SMOKE OK" : `SMOKE FAILED: ${failures.length}`)
process.exit(failures.length === 0 ? 0 : 1)
