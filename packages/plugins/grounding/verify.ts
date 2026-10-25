export * as Verify from "./verify"

import { readFile, realpath } from "node:fs/promises"
import path from "node:path"

// The advisory evidence check (contract agreed with Codex, VORTEX 476/478/480): it looks up the
// explicit path:first-last citations in a run's final text against the repository as it is now.
// It reports what it observed and nothing more: a range that exists does not make the claim
// about it true, and with no recorded evidence hashes it cannot tell whether a file changed
// after the model read it.

export interface Citation {
  path: string
  first: number
  last: number
}

export type Status = "exists" | "missing" | "outside-repo" | "bad-range"

export interface Result extends Citation {
  status: Status
  detail?: string
}

const MAX_CITATIONS = 40
const MAX_FILE_BYTES = 8 * 1024 * 1024

/** Explicit citations (`path.ext:12` or `path.ext:12-30`), each once, in order of appearance. */
export function citations(text: string): Citation[] {
  const found = [...text.matchAll(/(?<![\w./-])((?:[\w.@-]+\/)*[\w.@-]+\.[A-Za-z][\w]*):(\d+)(?:-(\d+))?/g)].map(
    (match) => ({ path: match[1], first: Number(match[2]), last: Number(match[3] ?? match[2]) }),
  )
  return found.filter(
    (cite, index) =>
      found.findIndex((other) => other.path === cite.path && other.first === cite.first && other.last === cite.last) ===
      index,
  )
}

/** Each citation looked up in the repository as it is now. */
export async function check(repo: string, cites: Citation[]): Promise<Result[]> {
  const root = await realpath(repo)
  return Promise.all(cites.map((cite) => one(root, cite)))
}

async function one(root: string, cite: Citation): Promise<Result> {
  if (path.isAbsolute(cite.path) || cite.path.split(/[\\/]/).includes("..")) return { ...cite, status: "outside-repo" }
  const real = await realpath(path.join(root, cite.path)).catch(() => undefined)
  if (!real) return { ...cite, status: "missing", detail: "no such file in the repository" }
  if (real !== root && !real.startsWith(root + path.sep)) return { ...cite, status: "outside-repo" }
  const text = await readFile(real).then(
    (bytes) => (bytes.length > MAX_FILE_BYTES ? undefined : bytes.toString("utf8")),
    () => undefined,
  )
  if (text === undefined) return { ...cite, status: "missing", detail: "not a readable file under 8 MB" }
  const lines = text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length
  if (cite.first < 1 || cite.last < cite.first || cite.last > lines)
    return { ...cite, status: "bad-range", detail: `the file has ${lines} lines` }
  return { ...cite, status: "exists" }
}

/** The note appended after a grounded run, or nothing when every checked citation exists. */
export async function note(input: { repo: string; sessionID: string; text: string }): Promise<string | undefined> {
  const all = citations(input.text)
  if (all.length === 0) return undefined
  const checked = all.slice(0, MAX_CITATIONS)
  const results = await check(input.repo, checked)
  const problems = results.filter((result) => result.status !== "exists")
  if (problems.length === 0) return undefined
  return [
    `<trailblazer-evidence-check checked="${results.length}" problems="${problems.length}">`,
    "Cited locations in the last answer that do not hold up against the repository as it is now:",
    ...problems.map(
      (result) =>
        `- ${result.path}:${result.first}-${result.last}: ${result.status}${result.detail ? ` (${result.detail})` : ""}`,
    ),
    ...(all.length > checked.length
      ? [`Only the first ${checked.length} of ${all.length} citations were checked.`]
      : []),
    "A cited range that exists does not show the claim about it is true.",
    "</trailblazer-evidence-check>",
  ].join("\n")
}
