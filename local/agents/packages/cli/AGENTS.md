# packages/cli

The `opencode` binary: commands (`src/commands/`), the server process wrapper (`src/server-process.ts`) and the build scripts (`script/`). The TUI it launches is `packages/tui`. The repository-wide rules are in the root `AGENTS.md`.

- Our patches here: `src/database-path.ts` (compiled `local`-channel builds use `opencode.db`) and `src/local-auth.ts` (`OPENCODE_SERVER_AUTH=disabled`, loopback only). Their tests are listed in `local/tests.txt`; keep them passing.
- Build only through `local/bin/opencode-update`. For a throwaway build: `OPENCODE_CHANNEL=local bun run script/build.ts --single`, then `git checkout -- .` (the build reorders manifests).
- Run from source against scratch data, never the live database: `XDG_DATA_HOME=/tmp/oc-scratch bun run src/index.ts serve --port 4196`. (A source run uses `opencode-local.db` by design.)
- TUI data goes through `@opencode/client` and the location-scoped data in `packages/tui/src/context/data.tsx`.
- Tests: `bun test --timeout 30000 <file>`; typecheck: `bun run typecheck`.
