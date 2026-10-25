---
name: app-e2e-tests
description: Use when writing, changing, or reviewing Playwright e2e tests in packages/app/e2e.
---

# App e2e Tests

Read `packages/app/e2e/AGENTS.md` and the Tests section of `packages/app/AGENTS.md` first. Follow the Testing section in the root AGENTS.md.

## Environment

- **Static Server**: Tests run against a Bun static server (`e2e/utils/serve.ts`) on `PLAYWRIGHT_PORT`.
- **Mock API**: Each page has an in-memory mock (`mockOpenCodeServer` in `e2e/utils/mock-server.ts`).
  - Unmocked routes fail with a 501 `Unmocked API request`.
- **Helpers**:
  - `mockWorkspace`, `openSession`, `openDraft`, `openWorktreeDraft` (`e2e/utils/workspace.ts`).
  - `setupTimeline` (`e2e/utils/timeline.ts`), `seed` and `holdRoute` (`e2e/utils/app.ts`).
  - `installSseTransport` (`e2e/utils/sse-transport.ts`) for delivering events.

## Isolation

- **No shared state**: No `beforeAll`, serial mode, or worker fixtures.
- **Mutation**: Mock handlers mutate objects passed to them; call `session()`/`project()` inside the test.
- **Timeline State**: Stateful builders (e.g., `assistantMessage`) must be called inside the test.
- **Seeding**: Call `seed` before the first `goto`.

## Performance

- **Navigation**: Minimize `goto` and `reload`.
- **Service Workers**: Blocked suite-wide (`serviceWorkers: "block"` in `playwright.config.ts`). Opt in only when the worker is the contract.
- **Route Matching**: Use RegExp or query-aware globs. Avoid function matchers to prevent intercepting all static assets.
- **Stress Fixtures**: Use `mockStressTimeline` only when scale is the contract.
- **Real-time waits**: Use `page.clock` to fast-forward timers instead of waiting.

## Race Conditions

- **Mounting**: First mount happens in stages. Wait for a final render signal (e.g., the last timeline row) before measuring or hovering.
- **Hovering**: Wait for the last row before hovering to avoid tooltip loss during scroll.
- **Measurements**: Polled reads are safer than one-shot `locator.evaluate` calls which can hit detached nodes.
- **Modals**: `goto` may return while a modal (e.g., "What's New") is still opening. Hold the request that opens it until readiness is asserted.
- **Shortcuts**: Global handlers ignore keys while `dialog.active` is true. Check this guard before adding waits.
- **Fonts**: Await `document.fonts.ready` before checking font-related state.

## Scheduling

- **Projects**: `chromium-touch-scroll` is a separate project for mobile tests.
- **Files**: In `chromium`, files are the scheduling unit. Keep cases cheap to avoid long tails.
- **Worker Options**: Use test-scoped options (e.g., `viewport`) instead of `launchOptions` to avoid forking workers.
- **Devices**: Do not spread `devices[...]` into `test.use`. Copy required fields.

## Before you push

Run from `packages/app`:
- [ ] `bun run test:e2e:built -- e2e/regression/<file>.spec.ts` passes.
- [ ] Use a free port (`PLAYWRIGHT_PORT=...`) to avoid interference.
- [ ] `--repeat-each=10 --workers=5 --retries=0` passes every time.
- [ ] **Rehearse slow loads**: Hold lazy chunks or API responses with `holdRoute` and release them after 0.6-1.5s.
- [ ] `bun run typecheck:e2e` reports no new errors.
