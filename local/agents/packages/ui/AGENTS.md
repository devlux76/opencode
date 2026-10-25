# packages/ui

The shared component library for the web UI: components, icons (`@opencode/ui/icons/catalog`), i18n and styles. The repository-wide rules are in the root `AGENTS.md`.

- User-visible text, including component defaults and accessible labels, uses i18n keys: `t(key)`, `plural(key, count, params)`, and `tDynamic(...)` for runtime-generated English that has keyed alternatives. Add English strings only; other locales fall back to English. Never branch on the active locale in component code.
- Line heights come from the shared variables: `--line-height-tight` (12px), `--line-height-compact` (16px), `--line-height-base` (20px). 13px Inter text needs at least 16px, or descenders clip under truncation. Keep `line-height: 1` for icons and glyphs.
- Components take server and session data as props; they do not call the OpenCode server. (`loadThemeFromUrl` in `src/theme/loader.ts` fetches a theme file, and `useFilteredList` filters items its caller provides; neither calls the server.)
- Tests: `bun test src`. Storybook (`packages/storybook`) is kept for visual work on these components.
