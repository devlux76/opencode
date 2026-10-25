---
name: tui-tests
description: Use when writing, fixing, or reviewing tests that render OpenTUI in packages/tui or packages/cli.
---

# TUI Tests

`packages/tui` runs many files in one `bun test` process. Follow the Testing section in the root AGENTS.md.

## Frame budgets

- **Passes vs Time**: `waitForFrame`, `waitFor`, and `flush` use `maxPasses` (default 20). This is a budget of rendered frames, not wall-clock time.
- **Renderer State**:
  - **Started**: Frames tick at 30 fps (approx 0.66s for 20 passes).
  - **Not started**: `waitFor` and `waitForFrame` fail immediately if no render is scheduled. Await the signal, then `renderOnce()`.
- **Wait on signals, not frames**:
  - **Focus**: Put the focus check in the predicate (e.g., `renderer.currentFocusedRenderable instanceof InputRenderable`).
  - **Markdown/Code**: Use `waitForHighlightedFrame` from `packages/tui/test/fixture/frame.ts` to await Tree-sitter highlights.
  - **State**: For requests or other state, poll with a wall-clock deadline rather than raising `maxPasses`.
- **Visual Idle**: `waitForVisualIdle` returns when `cellsUpdated === 0`. Wait for text first, then measure layout.

## Renderer mode and clock

- **Component logic**: Use `testRender(() => <X />, { width, height })` without `start()`. Change state, `await app.renderOnce()`, then assert.
- **Time-driven**: Inject `ManualClock`, call `renderer.pause()`, advance the clock, then `renderOnce()`.
- **Whole app**: Use `createAppFixture` from `packages/tui/test/fixture/app.ts`. Await `setup.ready` before the first wait.
- **Server behavior**: Use `createFetch` and `createEventStream` from `packages/tui/test/fixture/tui-client.ts` instead of spawning a real server.

## Keyboard and mouse

- **Input**: Use `setup.mockInput` (`pressKey`, `typeText`, etc.).
- **Kitty Mode**: Ensure `kittyKeyboard: true` is set to avoid dropped or incorrect input.
- **Clicks**: A second click within 500ms and 1 cell becomes a selection. Use `setup.renderer.clearSelection()` or click 2+ cells away to avoid this.

## Terminal sizes

- **Dimensions**: Always pass `width` and `height`.
- **Layout**: Cover narrow and wide widths (e.g., `test.each([100, 44])`). Resize with `setup.resize(w, h)`, then `await setup.renderOnce()` or `flush()`.
- **Performance**: Measure by counting (e.g., rendered rows), not by `performance.now()`.

## Cleanup and State

- **Cleanup**: Use `await using` or `finally` to destroy the renderer and stop fixture servers.
- **Temp Dirs**: `TestTuiContexts` (`packages/tui/test/fixture/tui-environment.tsx`) defaults to `/tmp/opencode/...`. Pass custom `paths` from `tmpdir()` to avoid shared-state flakes.

## Timeouts and Failures

- **Budget**: `bun test --timeout 30000` is for the cold `src/app` import, not for slow waits.
- **Frame failures**: "Timed out waiting for frame predicate" is a budget failure, not a Bun timeout. Do not raise `maxPasses` to fix it.
- **Flakes**: Do not skip a timing flake; fix the wait.

## Before you push

- Run from `packages/tui`: `bun test --timeout 30000 test/<file>`.
- [ ] `bun test --timeout 30000 test/<file> --rerun-each 10` passes every time.
- [ ] **Negative control**: Make the predicate impossible to ensure the test fails fast with a frame dump.
- [ ] **Race check**: Temporarily slow the timer or reply to ensure the test still passes.
