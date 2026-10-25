import { describe, expect, test } from "bun:test"
import { authDisabled } from "../src/local-auth"

describe("local auth", () => {
  test("auth stays on unless explicitly disabled", () => {
    expect(authDisabled({}, "127.0.0.1")).toBe(false)
    expect(authDisabled({ OPENCODE_SERVER_AUTH: "enabled" }, "127.0.0.1")).toBe(false)
  })

  test("disabled on a loopback hostname", () => {
    for (const hostname of ["127.0.0.1", "localhost", "::1"])
      expect(authDisabled({ OPENCODE_SERVER_AUTH: "disabled" }, hostname)).toBe(true)
  })

  test("refuses to disable auth on a non-loopback hostname", () => {
    expect(() => authDisabled({ OPENCODE_SERVER_AUTH: "disabled" }, "0.0.0.0")).toThrow(/loopback/)
    expect(() => authDisabled({ OPENCODE_SERVER_AUTH: "disabled" }, "192.168.1.5")).toThrow(/loopback/)
  })
})
