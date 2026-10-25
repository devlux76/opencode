import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Trailblazer } from "../trailblazer"

type Handler = (op: string, body: Record<string, unknown>, token: string) => Response | Promise<Response>

const cleanup: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step()
})

// A stand-in Trailblazer: the real API is POST /<op> with a bearer token and a JSON body.
async function fake(handler: Handler) {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (request) =>
      handler(
        new URL(request.url).pathname.slice(1),
        (await request.json()) as Record<string, unknown>,
        (request.headers.get("authorization") ?? "").replace(/^Bearer /, ""),
      ),
  })
  const dir = await mkdtemp(path.join(tmpdir(), "grounding-tb-"))
  const file = path.join(dir, "endpoint.json")
  const publish = (token: string) => writeFile(file, JSON.stringify({ url: `http://127.0.0.1:${server.port}`, token }))
  await publish("first")
  cleanup.push(
    () => server.stop(true),
    () => rm(dir, { recursive: true, force: true }),
  )
  return { file, publish }
}

const item = (over: Record<string, unknown> = {}) => ({
  id: 1,
  kind: "function",
  qualified: "defaultTimeout",
  path: "packages/core/src/tool/plugin/shell.ts",
  start_line: 26,
  end_line: 29,
  signature: "export function defaultTimeout(",
  stale: false,
  ...over,
})

test("reads the endpoint at request time and sends the bearer token and repo", async () => {
  const seen: Array<{ op: string; body: Record<string, unknown>; token: string }> = []
  const { file } = await fake((op, body, token) => {
    seen.push({ op, body, token })
    return Response.json([item()])
  })
  const answer = await Trailblazer.connect({ file }).call("where", { repo: "/r", name: "defaultTimeout" }, 1000)
  expect(answer).toEqual({ ok: true, value: [item()] })
  expect(seen).toEqual([{ op: "where", body: { repo: "/r", name: "defaultTimeout" }, token: "first" }])
})

test("on 401 rereads the endpoint once and retries with the new token", async () => {
  const tokens: string[] = []
  const { file, publish } = await fake((_op, _body, token) => {
    tokens.push(token)
    return token === "second" ? Response.json([]) : Response.json({ error: "unauthorized" }, { status: 401 })
  })
  const client = Trailblazer.connect({ file })
  await client.call("status", { repo: "/r" }, 1000) // 401, reread still "first", 401 again
  await publish("second")
  expect(await client.call("status", { repo: "/r" }, 1000)).toEqual({ ok: true, value: [] })
  expect(tokens).toEqual(["first", "first", "first", "second"])
})

test("a second 401 is reported, not retried forever", async () => {
  const { file } = await fake(() => Response.json({ error: "unauthorized" }, { status: 401 }))
  const answer = await Trailblazer.connect({ file }).call("status", { repo: "/r" }, 1000)
  expect(answer).toEqual({ ok: false, reason: "Trailblazer rejected the credentials (401)" })
})

test("an unwatched repository is reported as such", async () => {
  const { file } = await fake(() => Response.json({ error: "not watched" }, { status: 409 }))
  const answer = await Trailblazer.connect({ file }).call("trail", { repo: "/r", request: "x" }, 1000)
  expect(answer).toEqual({ ok: false, reason: "Trailblazer does not watch this repository" })
})

test("a slow answer is cut off at the bound and reported", async () => {
  const { file } = await fake(() => new Promise<Response>(() => {}))
  const started = performance.now()
  const answer = await Trailblazer.connect({ file }).call("trail", { repo: "/r", request: "x" }, 200)
  expect(answer).toEqual({ ok: false, reason: "Trailblazer did not answer trail within 200 ms" })
  expect(performance.now() - started).toBeLessThan(5_000)
})

test("a Trailblazer that is down fails at once, not at the bound", async () => {
  // A port that was just free: nothing listens there now.
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() })
  const port = probe.port
  probe.stop(true)
  const dir = await mkdtemp(path.join(tmpdir(), "grounding-tb-"))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, "endpoint.json")
  await writeFile(file, JSON.stringify({ url: `http://127.0.0.1:${port}`, token: "t" }))
  const started = performance.now()
  const answer = await Trailblazer.connect({ file }).call("trail", { repo: "/r", request: "x" }, 300_000)
  expect(answer.ok).toBe(false)
  expect(performance.now() - started).toBeLessThan(1_000)
})

test("a missing endpoint file means Trailblazer is not running", async () => {
  const answer = await Trailblazer.connect({ file: "/nonexistent/endpoint.json" }).call("status", { repo: "/r" }, 100)
  expect(answer).toEqual({ ok: false, reason: "Trailblazer is not running (no endpoint at /nonexistent/endpoint.json)" })
})

test("the endpoint file defaults under the state directory", () => {
  expect(Trailblazer.endpointFile({ TRAILBLAZER_STATE_DIR: "/s" }, "/h")).toBe("/s/endpoint.json")
  expect(Trailblazer.endpointFile({}, "/h")).toBe("/h/.local/share/trailblazer/endpoint.json")
})

test("parses a trail as Trailblazer sends it: items wrap their node with rank and form", () => {
  // Trail.item/3: %{node: Map.take(node, @summary), rank: rank, form: form}
  const wrap = (node: ReturnType<typeof item>, rank: number) => ({ node, rank, form: "full" })
  const parsed = Trailblazer.parseTrail({
    text: "packages/a.ts:1-2\ncode",
    tokens: 9,
    notes: [],
    items: [wrap(item(), 1), wrap(item({ id: 2, qualified: "other" }), 2)],
  })
  expect(parsed?.items).toEqual([item(), item({ id: 2, qualified: "other" })])
})

test("parses a trail, dropping items outside the repository and carrying notes", () => {
  const parsed = Trailblazer.parseTrail({
    text: "packages/a.ts:1-2\ncode",
    tokens: 9,
    notes: ["no vectors"],
    items: [item(), item({ path: "/etc/passwd" }), item({ path: "../outside.ts" }), item({ stale: true, id: 2 })].map(
      (node, i) => ({ node, rank: i + 1, form: "signature" }),
    ),
  })
  expect(parsed).toEqual({
    text: "packages/a.ts:1-2\ncode",
    notes: ["no vectors"],
    items: [item(), item({ stale: true, id: 2 })],
  })
})

test("drops nodes whose line range is impossible", () => {
  expect(
    Trailblazer.parseNodes([item({ start_line: 0 }), item({ start_line: 30, end_line: 29 }), item({ id: 3 })]),
  ).toEqual([item({ id: 3 })])
})

test("rejects a malformed trail", () => {
  expect(Trailblazer.parseTrail({ text: 3, items: [] })).toBeUndefined()
  expect(Trailblazer.parseTrail({ text: "x", items: [{ path: "a.ts" }] })).toBeUndefined()
  expect(Trailblazer.parseTrail("x")).toBeUndefined()
})

test("parses node lists from where, and search hits by their node", () => {
  expect(Trailblazer.parseNodes([item(), item({ path: "/abs.ts" })])).toEqual([item()])
  expect(Trailblazer.parseNodes([{ node: item(), via: "vector", score: 0.8 }])).toEqual([item()])
  expect(Trailblazer.parseNodes({ nope: true })).toBeUndefined()
})
