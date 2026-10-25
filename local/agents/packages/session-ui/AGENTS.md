# packages/session-ui

Components that render a session (timeline, messages, tool calls), shared by the web UI. The repository-wide rules are in the root `AGENTS.md`.

- User-visible text uses i18n keys (`i18n.t`, and `i18n.plural(key, count, params)` for counts). Add English strings only; other locales fall back to English.
- 13px text (transcript, tool, notice lines) uses `--line-height-compact` (16px); body text uses `--line-height-base` (20px). A tighter line box clips Inter's descenders when the text truncates or hides overflow. `TextShimmer` inherits font metrics, so style its parent.
- The timeline renders every message of long sessions: keep per-row work minimal and measure before and after a change (`packages/app/e2e/performance`).
- Tests: `bun test src` for units, `bun run test:components` (Playwright) for rendered behaviour.
