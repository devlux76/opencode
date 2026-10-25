export * as Trailblazer from "./trailblazer"

import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

// Client for Trailblazer's local HTTP API (~/projects/trailblazer/lib/trailblazer/api.ex):
// POST /<op> with a bearer token and a JSON body naming the repository. The endpoint file
// is rewritten whenever Trailblazer restarts, so it is read at request time, never cached
// across a 401. Every answer is untrusted input: shapes are checked and paths contained.

export type Answer<T> = { ok: true; value: T } | { ok: false; reason: string }

export interface Node {
  id: number
  kind: string
  qualified: string
  path: string
  start_line: number
  end_line: number
  signature: string
  stale: boolean
}

export interface Trail {
  text: string
  items: Node[]
  notes: string[]
}

interface Endpoint {
  url: string
  token: string
}

export function endpointFile(env: Record<string, string | undefined> = process.env, home = homedir()) {
  return path.join(env.TRAILBLAZER_STATE_DIR ?? path.join(home, ".local/share/trailblazer"), "endpoint.json")
}

export function connect(options: { file: string }) {
  let endpoint: Endpoint | undefined

  async function load() {
    const text = await readFile(options.file, "utf8").catch(() => undefined)
    if (text === undefined) return undefined
    const value: unknown = JSON.parse(text)
    if (!isRecord(value) || typeof value.url !== "string" || typeof value.token !== "string") return undefined
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(value.url)) return undefined
    return { url: value.url, token: value.token }
  }

  async function post(target: Endpoint, op: string, body: Record<string, unknown>, signal: AbortSignal) {
    return fetch(`${target.url}/${op}`, {
      method: "POST",
      headers: { authorization: `Bearer ${target.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    })
  }

  async function call(op: string, body: Record<string, unknown>, timeoutMs: number): Promise<Answer<unknown>> {
    const signal = AbortSignal.timeout(timeoutMs)
    try {
      endpoint ??= await load()
      if (!endpoint) return { ok: false, reason: `Trailblazer is not running (no endpoint at ${options.file})` }
      let response = await post(endpoint, op, body, signal)
      if (response.status === 401) {
        endpoint = await load()
        if (!endpoint) return { ok: false, reason: `Trailblazer is not running (no endpoint at ${options.file})` }
        response = await post(endpoint, op, body, signal)
      }
      if (response.status === 401) return { ok: false, reason: "Trailblazer rejected the credentials (401)" }
      if (response.status === 409) return { ok: false, reason: "Trailblazer does not watch this repository" }
      const value: unknown = await response.json().catch(() => undefined)
      if (!response.ok) {
        const error = isRecord(value) && typeof value.error === "string" ? value.error : "no detail"
        return { ok: false, reason: `Trailblazer ${op} failed (${response.status}: ${error.slice(0, 200)})` }
      }
      return { ok: true, value }
    } catch (error) {
      if (signal.aborted) return { ok: false, reason: `Trailblazer did not answer ${op} within ${timeoutMs} ms` }
      // A refused connection means a stale endpoint file; reread it next time.
      endpoint = undefined
      return { ok: false, reason: `Trailblazer ${op} failed (${error instanceof Error ? error.message : String(error)})` }
    }
  }

  return { call }
}

// trail items wrap their node with its rank and form (Trail.item/3).
export function parseTrail(value: unknown): Trail | undefined {
  if (!isRecord(value) || typeof value.text !== "string" || !Array.isArray(value.items)) return undefined
  const items = value.items.map((entry) => parseNode(isRecord(entry) && isRecord(entry.node) ? entry.node : entry))
  if (items.some((item) => item === undefined)) return undefined
  const notes = Array.isArray(value.notes) ? value.notes.filter((note): note is string => typeof note === "string") : []
  return { text: value.text, items: (items as Node[]).filter(contained), notes }
}

// where answers nodes; search and uses wrap each node with how it was found.
export function parseNodes(value: unknown): Node[] | undefined {
  if (!Array.isArray(value)) return undefined
  const nodes = value.map((entry) => parseNode(isRecord(entry) && isRecord(entry.node) ? entry.node : entry))
  if (nodes.some((node) => node === undefined)) return undefined
  return (nodes as Node[]).filter(contained)
}

function parseNode(value: unknown): Node | undefined {
  if (!isRecord(value)) return undefined
  const { id, kind, qualified, path: file, start_line, end_line, signature, stale } = value
  if (typeof id !== "number" || typeof kind !== "string" || typeof qualified !== "string") return undefined
  if (typeof file !== "string" || typeof signature !== "string" || typeof stale !== "boolean") return undefined
  if (!Number.isInteger(start_line) || !Number.isInteger(end_line)) return undefined
  return {
    id,
    kind,
    qualified,
    path: file,
    start_line: start_line as number,
    end_line: end_line as number,
    signature,
    stale,
  }
}

// Trailblazer answers repository-relative paths and 1-based line ranges; anything else is not ours to show.
function contained(node: Node) {
  if (path.isAbsolute(node.path) || node.path.split(/[\\/]/).includes("..")) return false
  return node.start_line >= 1 && node.end_line >= node.start_line
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
