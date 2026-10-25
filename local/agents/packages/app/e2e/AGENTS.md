# packages/app/e2e (Playwright)

- Test what the user sees and can do, with isolated, deterministic data and specific locators (role, label, text, or an explicit test id). No `.first()`/`.last()` to silence a strictness error.
- Never synchronize with sleeps, `waitForTimeout` or frame counts. Wait for the state the next step needs, using web-first assertions. Register event and network waits before the action that triggers them.
- Retry readiness checks, never state-changing actions. Assert exact outcomes so stale or duplicated UI cannot pass.
- One keeper suite per product area in `regression/`; a new regression is a new case there, not a new file.
- Build pages with the shared harness in `utils/` (`app.ts`, `workspace.ts`, `mock-server.ts`). If it lacks something, add it there once. Files in `utils/` must not end in `.spec.ts` or `.test.ts`.
- `performance/` holds benchmarks, which do not prove correctness and are not part of the normal run.
- Run: `bun run test:e2e` from `packages/app`.
