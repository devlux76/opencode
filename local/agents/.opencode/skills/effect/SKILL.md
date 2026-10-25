---
name: effect
description: Use when writing, reviewing or debugging Effect v4 TypeScript in this repository (services, layers, Schema, typed errors, Effect tests).
---

# Effect

This repository uses Effect v4 (effect-smol). Its API differs from Effect 2/3 and from most examples online.

## Check the source, not memory

- The project config references `effect` (github.com/Effect-TS/effect-smol). Look up exact signatures, examples and tests there before using an API you are not sure of.
- Then copy the house style from nearby code in the same package. Prefer a pattern the package already uses over a new one.

## Writing it

- Multi-step workflows: `Effect.gen(function* () { ... })`. Name reusable service methods and important workflows with `Effect.fn("Service.method")` (or `Effect.fnUntraced` on hot paths).
- Services are `Context` services provided by `Layer`s. Bind a service to a name (`const store = yield* Store.Service`) and call its methods; keep layer composition explicit so a missing dependency is a type error, not a runtime surprise.
- Data shapes are `Schema`: branded schemas for IDs, `Schema.TaggedError` for typed domain errors. Contracts shared across packages live in `packages/schema` (see its `AGENTS.md`).
- HTTP handlers stay thin: decode input, read request context, call a service, map errors to the transport. Business rules live in services.
- Read time through `Clock` and wait with `Effect.sleep` or `Schedule`. A bare `Effect.runPromise` inside product code runs on the real clock and escapes the caller's context; capture `yield* Effect.context()` and use `Effect.runPromiseWith(context)`.
- No `any`, non-null assertions or unchecked casts to satisfy the checker, and no older-Effect APIs because an example used them.

## Testing it

- `testEffect(layer)` from `packages/core/test/lib/effect.ts` gives `it.effect` (runs on `TestClock`) and `it.live` (real clock). `server` and `cli` import it by relative path; `packages/ai/test/lib/effect.ts` is the ai copy.
- `it.effect` for logic and timing: move time with `TestClock.adjust`, after the code under test has registered its sleep (fork with `Effect.forkChild({ startImmediately: true })` or await a `Deferred` it completes, then `Effect.yieldNow`).
- `it.live` when real processes, sockets, file events or a real deadline drive the outcome: under `it.effect` such a timeout never fires and a missing event hangs instead of failing.
- Provide test dependencies through explicit test layers in the test file. Scope resources (temp directories, databases, servers, fibers) so finalizers clean them up.
- Run tests from the package directory (core: `bun run script/test.ts <file>`). More in the `unit-tests` skill.
