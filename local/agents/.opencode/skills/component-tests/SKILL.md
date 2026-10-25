---
name: component-tests
description: Use when writing, changing, or reviewing Storybook-based Playwright component tests.
---

# Component Tests

Each suite starts one Storybook/Vite dev server shared by workers. Follow `packages/app/AGENTS.md` and `packages/app/e2e/AGENTS.md` for test hygiene. Refer to the root AGENTS.md for general testing rules.

## Stories and `mount`

- **Location**: Put stories next to components in `src/`.
- **Story ID**: Use the meta `id` or the kebab-cased title + export.
- **Args**:
  - `mount(id, { args })` writes args into the URL.
  - Storybook drops args not declared in `args`/`argTypes` or containing punctuations.
  - Use typed defaults in stories; use a `scenario` arg for punctuated values.
- **Portaled UI**: Dialogs and menus render outside `#storybook-root`; locate them via `page`.
- **Mocks**: Server state comes from `packages/storybook/.storybook/mocks/app/**`. Restore mock state in `onCleanup`.

## Fixtures imported by URL

Use when the contract involves construction counts or cache state.

- **Fixture File**: `*.fixture.tsx` in `component-tests/` or beside source.
- **Mounting**:
  1. Mount a light story first for styles.
  2. Call the fixture inside `page.evaluate`.
  3. Locate with `page.getByTestId`.
- **URLs**: Use `sourceURL(new URL("<relative path>", import.meta.url))` as a string literal.
- **Imports**: Use `import type` only in specs.

## Vite pre-bundling and reloads

`viteFinal` in `main.ts` optimizes dependencies. A missing dependency causes a "full-reload" and a 504 "Outdated Optimize Dep".

- **Goal**: Zero reloads.
- **Scan**: Ensure modules are reachable by the scan (name stories `*.stories.tsx`, workers `*.worker.ts`, and use string literals for paths).
- **Cache**: Delete `packages/storybook/node_modules/.cache` before judging reloads.
- **Resolution**: Use package resolution, not paths into `node_modules`.

## Cold vs Warm mounts

- **Cost**: Warm `mount` (navigation + root wait) takes ~1-2s.
- **Local reuse**: Use `PLAYWRIGHT_STORYBOOK_PORT` to avoid interference between worktrees.
- **Efficiency**: Keep mounts few; resize in place with `page.setViewportSize`.

## Mobile and Drawers

- **Touch**: Use `story.use({ hasTouch: true, isMobile: true, viewport: { ... } })`.
- **Drawers**: Below 768px, pickers open in a bottom drawer. Wait until it is fully in the viewport and has no `data-transitioning` before measuring.

## Geometry and Fonts

- **Fonts**: Wait for `document.fonts.ready` before measuring layout to avoid shifts.
- **Page scroll**: Do not give a story root `100vh` to avoid shifts in the Storybook preview frame.
- **Shortcuts**: Use `ControlOrMeta+...`.

## Before you push

From the owning package (`packages/session-ui` or `packages/app`):
- [ ] `bun run test:components -- <file>.spec.ts --workers=2 --repeat-each=10` passes every time.
- [ ] **Cold run**: Run a suite cold (clear `.cache`, use a free port) and grep logs for `optimized dependencies changed`.
- [ ] **Load**: Throttle CPU via CDP `Emulation.setCPUThrottlingRate` to check for races.
- [ ] **Verification**: Verify platform keys and font-dependent geometry.
