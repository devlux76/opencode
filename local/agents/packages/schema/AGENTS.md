# packages/schema

Browser-safe wire and storage contracts shared by `protocol`, `server`, `core` and the generated client. Runtime behaviour, services and side effects stay in the package that owns the domain. The repository-wide rules are in the root `AGENTS.md`.

- Dependency direction: `schema` <- `protocol` <- `server`. Nothing here imports runtime packages.
- Contracts are serializable definitions, not services or registries.
- Current contracts are unversioned (`Session`, `Permission.Request`). Legacy contracts kept for migration live in `src/v1/` and are named `...V1`; new code never imports from `src/v1/`. Delete V1 pieces when the migration that needs them is gone.
- One canonical exported value per contract. No aliases or second definitions; facades elsewhere re-export the exact value.
- Optional object fields use this package's `optional(...)` (`src/schema.ts`) so encoded objects omit `undefined` keys. Defaults for external input are decode-only (`Schema.withDecodingDefault`).
- Public contracts are readonly. Prefer `Schema.Json` for JSON values and `Schema.Unknown` for opaque ones; avoid `Schema.Any`.
- Public structs follow `export interface Info extends Schema.Schema.Type<typeof Info> {}` next to `export const Info = Schema.Struct({...})`. Schema values are `PascalCase`, combinators `camelCase`.
- Generated ID schemas validate exactly the prefix they emit. Do not tighten an existing loose ID validator without a migration plan: stored data depends on it.
- A contract change ships with a focused test, and with `bun run generate` in `packages/client` when it reaches the public API. Tests: `bun test` here.
