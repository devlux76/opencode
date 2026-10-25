import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Verify } from "../verify"

const cleanup: string[] = []
afterEach(async () => {
  for (const dir of cleanup.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function repo() {
  const dir = await mkdtemp(path.join(tmpdir(), "grounding-verify-"))
  cleanup.push(dir)
  await mkdir(path.join(dir, "src"))
  await writeFile(path.join(dir, "src/a.ts"), Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n") + "\n")
  return dir
}

test("finds path:first-last and path:line citations, once each", () => {
  expect(
    Verify.citations("See src/a.ts:3-5 and `src/b.tsx:7`, also src/a.ts:3-5 again; v1.2 and 10:30 are not paths."),
  ).toEqual([
    { path: "src/a.ts", first: 3, last: 5 },
    { path: "src/b.tsx", first: 7, last: 7 },
  ])
})

test("checks each citation against the repository", async () => {
  const dir = await repo()
  const results = await Verify.check(dir, [
    { path: "src/a.ts", first: 2, last: 4 },
    { path: "src/missing.ts", first: 1, last: 1 },
    { path: "src/a.ts", first: 9, last: 30 },
    { path: "src/a.ts", first: 5, last: 3 },
    { path: "../outside.ts", first: 1, last: 1 },
    { path: "/etc/passwd", first: 1, last: 1 },
  ])
  expect(results.map((result) => result.status)).toEqual([
    "exists",
    "missing",
    "bad-range",
    "bad-range",
    "outside-repo",
    "outside-repo",
  ])
})

test("a symlink that leaves the repository counts as outside it", async () => {
  const dir = await repo()
  const { symlink } = await import("node:fs/promises")
  await symlink("/etc/hostname", path.join(dir, "src/escape.ts"))
  const [result] = await Verify.check(dir, [{ path: "src/escape.ts", first: 1, last: 1 }])
  expect(result.status).toBe("outside-repo")
})

test("all citations present: nothing to say", async () => {
  const dir = await repo()
  expect(await Verify.note({ repo: dir, sessionID: "s", text: "Changed src/a.ts:1-2." })).toBeUndefined()
})

test("no citations: nothing to say (plenty of answers have none)", async () => {
  const dir = await repo()
  expect(await Verify.note({ repo: dir, sessionID: "s", text: "Done, all good." })).toBeUndefined()
})

test("problems are named, with what the check cannot show", async () => {
  const dir = await repo()
  const note = await Verify.note({
    repo: dir,
    sessionID: "s",
    text: "Updated src/a.ts:2-3, src/gone.ts:4-8 and src/a.ts:8-40.",
  })
  expect(note).toBeDefined()
  expect(note!.startsWith('<trailblazer-evidence-check checked="3" problems="2">')).toBe(true)
  expect(note).toContain("- src/gone.ts:4-8: missing (no such file in the repository)")
  expect(note).toContain("- src/a.ts:8-40: bad-range (the file has 10 lines)")
  expect(note).toContain("A cited range that exists does not show the claim about it is true.")
  expect(note!.endsWith("</trailblazer-evidence-check>")).toBe(true)
})

test("a long answer is checked up to the cap, and says so", async () => {
  const dir = await repo()
  const text = Array.from({ length: 60 }, (_, i) => `src/gone${i}.ts:1-2`).join(" ")
  const note = await Verify.note({ repo: dir, sessionID: "s", text })
  expect(note).toContain('checked="40"')
  expect(note).toContain("Only the first 40 of 60 citations were checked.")
})
