# packages/plugin

The API that plugins are written against, in two flavours: Effect (`src/effect/`) and Promise (`src/promise/`). The repository-wide rules are in the root `AGENTS.md`.

- Each Effect plugin domain extends the matching client interface from `@opencode/client/effect/api` and adds only what makes sense inside a plugin. Do not redefine a function the client already has.
- Keep the Effect and Promise flavours equivalent: a capability added to one is added to the other in the same change.
- This is a public surface for plugin authors (including us). Changing a signature is a breaking change for every installed plugin: say so in the commit.
- Tests: `bun test` from this directory.
