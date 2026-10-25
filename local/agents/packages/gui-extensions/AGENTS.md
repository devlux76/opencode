# packages/gui-extensions

Built-in features of the web UI, each written as an extension against the SDK in `src/sdk/`. The window-side host is `packages/app/src/runtime/extension/`. `README.md` is the detailed author guide. The repository-wide rules are in the root `AGENTS.md`.

## State of this package in our fork

- The desktop app, which hosted the main-process side (`main.ts` entries and their `Ipc` contracts), has been removed. In the web UI every `Ipc` is inactive, so main-process code here no longer runs. Treat it as a removal candidate; do not build new features on `Ipc`.

## Structure

- One folder per extension: `index.ts` (`Extension.define(...)`), `contract.ts`, `renderer.tsx`, optional `main.ts`, and `i18n/en.ts`.
- `src/renderer.ts` (and `src/main.ts`) are the only places that list built-ins, through `Extension.compose`.
- Another extension may import only your `contract.ts` (tokens and schemas). Declare what you consume in `uses` (degrades gracefully) or `requires` (meaningless without it); declare what you offer in `provides`.
- Never import `@opencode/app` or `@/` paths. Keep state inside `setup`, not at module level.
- The host must not know extension internals (ids, selectors, storage keys). If the host needs something, add a documented, generic SDK field.

## Lifetimes and failure

- Anything you start outside `ctx` (DOM listeners, subscriptions) needs teardown (`onCleanup` in the window).
- Window `setup` is synchronous. Put async work in `createKeyed`/`createLatest` (`src/sdk/reactive.ts`) and, after every `await`, return if `ctx.signal` aborted before touching state.
- A dependency can be `pending`, `inactive` or `blocked`. Every user action handles that and still answers: offer the action only while it can work, or show an unavailable state. Never a silent `return` or an endless spinner.
- Stored state lives under your extension's id (`Store.global`, `Store.session`). A session store's value is undefined until it loads.

## Reactive code

- Derive, don't sync: computed values are memos or functions. `createEffect`/`createRenderEffect`/`createComputed` are for the SDK only; extensions use `createKeyed` for side work that tracks a source.
- Keep `renderer.tsx` small (it loads with the app); put heavy UI behind `lazy()` in its own `<Suspense>`, and preload it when idle.

## Docs, copy and tests

- Every export in `src/sdk/` has TSDoc saying what it is, when to use it, its default and what happens on failure. Change the TSDoc and `README.md` with the SDK.
- Copy lives in each extension's `i18n/en.ts`; count-sensitive copy goes through `ctx.plural`.
- Unit-test pure logic that carries a contract (path checks, storage migration, parsing). UI behaviour is proven by the app's e2e suites. Run `bun test` here.
