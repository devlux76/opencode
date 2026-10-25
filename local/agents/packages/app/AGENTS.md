# packages/app (web UI)

The SolidJS + Vite web UI. `opencode-update` builds it into the CLI binary (`packages/cli/script/app-assets.ts`), so the live server serves it at http://127.0.0.1:4096. It is the likely seat of the operator's director's chair. The repository-wide rules are in the root `AGENTS.md`.

## Working on it

- Build: `bun run build`. Its icons come from `../desktop/icons`, kept on purpose when the desktop app was removed.
- Iterate with `bun run dev -- --port 4444` and connect it to a scratch server (for example `cd packages/cli && OPENCODE_SERVER_AUTH=disabled XDG_DATA_HOME=/tmp/oc-scratch bun run src/index.ts serve --port 4196`). Point it at the live server on 4096 only for read-only checks: the live sessions are real work.
- Never restart or kill the live server; ship through `opencode-update`.
- Before changing session or timeline rendering, run the relevant benchmark in `e2e/performance/` before and after, and report both numbers.

## Solid

- `createStore` for objects and collections, `createSignal` for single values. Derive with `createMemo` or a plain function; never copy state into another signal through an effect.
- Logic caused by a user action goes in that action's handler, not in an effect watching the state it changed.
- Read props as `props.x` (no destructuring) and use `<Show>`/`<For>` in JSX.

## Async data and Suspense

- Reading `resource()` suspends while it loads, and so does `resource.latest` until the first value. Guard render-time reads and keep showing what you have: `const loaded = () => resource.state === "ready" || resource.state === "refreshing"` (example: `worktreesLoaded` in `src/new-session/workspace/controller.ts`).
- When the source can change (another project or session), put its key in the fetched value and use the result only when the key matches.
- A `<Suspense>` boundary only decides what blanks. Suspend on purpose, on first load only, and say why in a comment.

## Copy

- User-visible text goes through the i18n keys: `language.t(key)` and `language.plural(key, count)`. Add English strings only; other locales fall back to English. Do not compose sentences from fragments.

## Tests

- `bun run test:unit`, `bun run test:browser`, `bun run test:e2e` (Playwright, see `e2e/AGENTS.md`), `bun run test:components`.
- Test a behaviour once, at the strongest boundary that observes it. A regression test must fail on the code before the fix.
