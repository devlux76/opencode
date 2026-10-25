import { describe, expect, test } from "bun:test"
import { databasePath } from "../src/database-path"

describe("database path", () => {
  test("a compiled local-channel build shares the release database", () => {
    expect(databasePath("/data", "local", "2.1.4-local.abc1234")).toBe("/data/opencode.db")
  })

  test("running from source keeps its own local database", () => {
    expect(databasePath("/data", "local", "local")).toBe("/data/opencode-local.db")
  })

  test("release channels share the release database", () => {
    expect(databasePath("/data", "latest", "2.1.4")).toBe("/data/opencode.db")
  })

  test("other preview channels get their own database", () => {
    expect(databasePath("/data", "feat/x", "0.0.0-feat-x-1")).toBe("/data/opencode-feat-x.db")
  })
})
