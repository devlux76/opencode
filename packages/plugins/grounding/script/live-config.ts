// Does grounding reach the model with the deployed release and the real global config (other
// plugins included)? Runs the release binary on a random port with scratch data and a copy of
// ~/.config/opencode, the default model swapped for a fake one that records its requests, against
// the real Trailblazer and the ~/vendor/opencode checkout. Never touches the live server or its
// database. Usage: bun run script/live-config.ts   (exits non-zero unless the block and tools arrive)
// This is what caught superpowers' tagged text hiding the prompt; script/smoke.ts uses a bare config.
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const root = await mkdtemp(path.join(tmpdir(), "grounding-live-config-"))
const failures: string[] = []
const requests: any[] = []
const model = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: async (request) => {
    requests.push(await request.json())
    const chunk = (delta: object, finish: string | null) =>
      `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    return new Response(chunk({ role: "assistant", content: "ok" }, null) + chunk({}, "stop") + "data: [DONE]\n\n", {
      headers: { "content-type": "text/event-stream" },
    })
  },
})
const xdg = Object.fromEntries(["CONFIG", "DATA", "STATE", "CACHE"].map((n) => [`XDG_${n}_HOME`, path.join(root, n.toLowerCase())]))
await mkdir(path.join(xdg.XDG_CONFIG_HOME, "opencode"), { recursive: true })
await cp(path.join(process.env.HOME!, ".config/opencode/AGENTS.md"), path.join(xdg.XDG_CONFIG_HOME, "opencode/AGENTS.md"))
await cp(path.join(process.env.HOME!, ".config/opencode/agent"), path.join(xdg.XDG_CONFIG_HOME, "opencode/agent"), { recursive: true })
let config = await readFile(path.join(process.env.HOME!, ".config/opencode/opencode.jsonc"), "utf8")
config = config.replace('"model": "opencode/beam-free",', `"model": "fake/m",`)
config = config.replace(
  '"provider": {',
  `"providers": { "fake": { "name": "Fake", "package": "@opencode/ai/providers/openai-compatible", "settings": { "baseURL": "http://127.0.0.1:${model.port}/v1", "apiKey": "x" }, "models": { "m": { "name": "M", "capabilities": { "tools": true } } } } },\n  "provider": {`,
)
await writeFile(path.join(xdg.XDG_CONFIG_HOME, "opencode/opencode.jsonc"), config)

const port = 20_000 + Math.floor(Math.random() * 20_000)
const binary = path.join(process.env.HOME!, ".local/share/opencode-local/current/opencode")
const server = Bun.spawn([binary, "serve", "--port", String(port), "--hostname", "127.0.0.1"], {
  env: { ...process.env, ...xdg, OPENCODE_SERVER_AUTH: "disabled" },
  stdout: Bun.file(path.join(root, "stdout.log")),
  stderr: Bun.file(path.join(root, "stderr.log")),
})
const base = `http://127.0.0.1:${port}`
const until = async (f: () => Promise<boolean> | boolean, ms = 120_000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await Promise.resolve().then(f).catch(() => false)) return true
    await Bun.sleep(300)
  }
  return false
}
try {
  await until(async () => (await fetch(`${base}/api/info`)).ok)
  const post = (route: string, body: unknown) =>
    fetch(base + route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json())
  const created: any = await post("/api/session", { title: "diag", location: { directory: "/home/mirai/vendor/opencode" } })
  await post(`/api/session/${created.data.id}/prompt`, { text: "where is authDisabled called? cite path:first-last", delivery: "queue" })
  // The plugin may wait on a real trail before the first request goes out.
  if (!(await until(() => requests.length >= 1, 360_000))) failures.push("no model request within 6 minutes")
  const req = requests[0]
  const text = (message: any) =>
    typeof message.content === "string"
      ? message.content
      : (message.content ?? []).map((part: any) => part.text ?? "").join("")
  const block = (req?.messages ?? []).map(text).find((t: string) => t.includes("<trailblazer-grounding "))
  // The block's header and its own state lines (degraded/unavailable), if any.
  const state = block?.split("\n").filter((line: string) => line.startsWith("<trailblazer") || line.startsWith("Grounding"))
  console.log(state ? `block: ${state.join(" | ")}` : "no grounding block in the first request")
  if (!block) failures.push("no grounding block")
  else if (!block.includes('source="trail"')) failures.push("grounding degraded: no trail")
  const tools = (req?.tools ?? []).map((t: any) => t.function.name).filter((n: string) => n.startsWith("trailblazer_"))
  console.log("tools:", tools.join(", "))
  if (tools.length !== 4) failures.push("Trailblazer tools missing")
} finally {
  server.kill()
  await server.exited
  model.stop(true)
  if (failures.length === 0) await rm(root, { recursive: true, force: true })
  else console.log("kept", root, "for inspection")
}
console.log(failures.length === 0 ? "LIVE CONFIG OK" : `LIVE CONFIG FAILED: ${failures.join("; ")}`)
process.exit(failures.length === 0 ? 0 : 1)
