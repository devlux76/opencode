import { expect } from "bun:test"
import { Effect } from "effect"
import { HttpServer } from "effect/http"
import { it } from "../../core/test/lib/effect"
import { ServerProcess } from "../src/process"

// Our fork: a server started without a password answers every request without credentials.
it.live("a server without a password serves the API without credentials", () =>
  Effect.gen(function* () {
    const server = yield* ServerProcess.start<never, never>({ hostname: "127.0.0.1", port: 0, database: { path: ":memory:" } })
    const base = HttpServer.formatAddress(server.address)
    const status = (path: string) => Effect.promise(() => fetch(new URL(path, base)).then((response) => response.status))

    expect(yield* status("/api/info")).toBe(200)
    expect(yield* status("/api/session")).toBe(200)
  }),
)

it.live("a server with a password still refuses requests without credentials", () =>
  Effect.gen(function* () {
    const server = yield* ServerProcess.start<never, never>({
      hostname: "127.0.0.1",
      port: 0,
      password: "secret",
      database: { path: ":memory:" },
    })
    const base = HttpServer.formatAddress(server.address)
    const response = yield* Effect.promise(() => fetch(new URL("/api/session", base)))

    expect(response.status).toBe(401)
  }),
)
