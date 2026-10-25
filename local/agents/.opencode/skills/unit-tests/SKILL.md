---
name: unit-tests
description: Use when writing, reviewing, or fixing `bun test` unit tests in any package, except OpenTUI renderer tests.
---

# Unit Tests

Follow the Testing section in the root AGENTS.md.

## Budget and Timeouts

- **Default Timeout**: Bun's default is 5000ms.
- **Package Defaults**:
  - 30s: `ai`, `cli`, `http-recorder`, `latex`, `merman`, `simulation`, `theme`, `tui`; `core` through its runner, `bun run script/test.ts <file>` (which also isolates HOME).
  - 5s: `client`, `httpapi-codegen`, `sdk`, `app`, `codemode`, `function`, `gui-extensions`, `plugin`, `plugin-browser`, `script`, `server`, `session-ui`, `ui`, `util`.
- **Per-test timeouts**: Use only when legitimately needed and add a comment naming the work.

## Control time; do not wait for it

- **Effect code**: Use `it.effect` from `packages/core/test/lib/effect.ts` (runs on `TestClock`).
  - **Fork, then adjust**: Fork with `Effect.forkChild({ startImmediately: true })` or await a `Deferred` before calling `TestClock.adjust`.
  - **Debounced streams**: Use `advance(condition)` and `drain` from `packages/core/test/lib/clock.ts` to avoid `Bun.sleep`.
  - **Real events**: Use `it.live` for paths driven by real processes, sockets, or file events.
- **Code outside Effect**: Use `jest.useFakeTimers()` and `setSystemTime` from `bun:test`, restored in `afterEach`.
  - **Advance**: Use `jest.advanceTimersToNextTimer()` instead of fixed small steps.

## Real-time waits

- **Deadlines, not counts**: Bound polls in milliseconds (e.g., 10s or 30s) and return as soon as they hold. Do not use attempt-count loops.
- **Inter-process waits**: `TestClock` cannot reach spawned servers.
  - Test timing logic in-process under `TestClock` where possible.
  - Shorten production durations via options (e.g., `withEnsureTiming` in `packages/client/src/service-timing.ts`).
- **Wall-clock speed**: Do not assert elapsed time. Count operations or use an input that trips the test timeout on regression.

## Spawning and Git

- **Minimize spawns**: Test parsing and validation in-process.
- **CLI isolation**: Use `isolatedEnv(root)` from `packages/cli/test/fixture/environment.ts`.
- **Git fixtures**: Use `packages/core/test/fixture/git.ts`:
  - `initGit(directory, ...initArgs)`
  - `initRepo`
  - `gitRemote`
- **Concurrency**: Start independent children together using `Promise.all`.

## Temp dirs and Process State

- **Temp Dirs**: Use `tmpdir()`, `tmpdirScoped`, or `withTempDir` from `packages/core/test/fixture/tmpdir.ts`.
- **Env**: Use `withEnv` from `packages/core/test/fixture/env.ts` or `afterEach` for restoration.
- **CI mode**: To test the non-CI path, explicitly unset `CI` in the test.

## Independence and Isolation

- **No `--isolate`**: Do not add `--isolate` or bare `--parallel` to test scripts.
- **No `mock.module`**: It leaks across files.
- **Dependency Injection**: In Effect packages, use test layers. In others, inject through existing product parameters.

## Turbo test tasks

- **Script requirement**: A package must have a `test` script to be run by `bun turbo test`.
- **Builds**: Tests must not read a dependency's `dist` folder.

## Before you push

- Run from the package directory with the script's flags.
- [ ] `bun test <file> --rerun-each 10` passes every time.
- [ ] Grep the diff for `Bun.sleep(`, `setTimeout(`, `Date.now() +`, `performance.now()`, `Effect.runPromise(`.
- [ ] Check for `mock.module` and literal port numbers.
