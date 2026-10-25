import { describe, expect, test } from "bun:test"
import { ShellTool } from "@opencode/core/tool/plugin/shell"

describe("ShellTool default timeout", () => {
  test("defaults to two minutes", () => {
    expect(ShellTool.defaultTimeout({})).toBe(120_000)
  })

  test("OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS raises it", () => {
    expect(ShellTool.defaultTimeout({ OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS: "600000" })).toBe(600_000)
  })

  test("ignores values that are not positive integers", () => {
    for (const value of ["", "0", "-5", "abc", "1.5"])
      expect(ShellTool.defaultTimeout({ OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS: value })).toBe(120_000)
  })
})
