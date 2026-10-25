---
name: opencode-dev
description: Use when interactively running, debugging, or verifying opencode's own CLI/TUI or server during development in this repo.
---

# Debugging opencode

Workflow for exercising the CLI/TUI and server. All commands run from `packages/cli` unless noted.

## This machine

- **Live Server**: The user unit `opencode.service` runs `opencode serve` on 127.0.0.1:4096 with database `~/.local/share/opencode/opencode.db` (the operator's history). Never restart it, never point experiments at it, and never write to that database. Deploys happen only through `local/bin/opencode-update`.
- **Service Config**: Both `bun dev` and installed builds use channel `local`, sharing `~/.local/state/opencode/service-local.json` (`filename()` in `packages/cli/src/services/service-config.ts`) and the default port 0xc0df.
- **Dev Isolation**: Always run dev work with `--standalone` (a private server) and point data at a scratch location (`OPENCODE_DB` or XDG dirs under a temp directory).
- **Databases**: Source runs use `opencode-local.db`; compiled `local` releases use `opencode.db` (`packages/cli/src/database-path.ts`).
- **Logging**: The live server and source runs both log to `~/.local/share/opencode/log/opencode-local.log`; filter by `run=<id>` and `role=server|cli`.

## Server/client model

opencode is a client/server system:

- **Server process**: Runs the Effect HTTP API (`packages/server`) and owns all domain state. Started by the `serve` command.
- **TUI process**: An HTTP/SSE client of the server via `@opencode/client`.
- **Discovery**: CLI processes find the server through the service registration file.
- **Sharing**: Multiple invocations converge on one shared background daemon. `bun dev service start|status|stop|restart` manages this lifecycle.
- **Standalone mode** (`--standalone`): Spawns a private one-off server tied to the process lifetime with a random password.
- **Logs**: Every line is tagged `role=server` or `role=cli` and a per-process `run=<id>`.

## Starting the dev TUI

- Run `bun dev --standalone` from `packages/cli` (or root) to ensure a private server tied to the process.
- **Forbidden**: `bun run dev:live` from the root (runs against the installed live server and real sessions).

## Interactive debugging

- **TUI Driving**: `termctrl` is not installed on this machine. If available, use it for interactive checks.
- **Wait for text**: Wait for expected screen text (e.g., `Ask anything`) before interacting instead of using fixed sleeps.
- **Drive input**: Use `termctrl send` with `text:` prefix and separate control keys.
- **Inspect**: Use `termctrl show` and save PNG evidence for user-visible bugs.
- **Restarts**: Use `termctrl restart` for TUI changes; `bun dev service restart` for server-side changes (or use `--standalone`).

## Server/API debugging

- **API tool**: `bun dev api` sends requests using the same discovery/auth path as the CLI.
- **Introspection**: Use it to compare raw server state with TUI rendering.
- **Calls**: Accepts OpenAPI operation IDs or raw HTTP method + path:
  - `bun dev api get /api/info`
  - `bun dev api <operationId> --param key=value`
- **Data**: Pass JSON bodies with `-d`.

## Auditing sessions

For a `ses_...` ID, compare:
- Live server state via `opencode api`.
- Durable history in the SQLite `event` rows.
- Client projection in `packages/tui/src/context/data.tsx`.

To find a database without modifying it, use `sqlite3 "file:$db?mode=ro"`.

## Logs

- Files live under `~/.local/share/opencode/log/`. Local/dev checkout uses `opencode-local.log`.
- Filter by `run=<id>` and `role=server|cli`.
- **Environment**: `OPENCODE_LOG_LEVEL` controls verbosity; `OPENCODE_PRINT_LOGS=1` tees logs to stderr.

## Heap snapshots and CPU profiles

- **Heap Dumps**: `opencode debug heap-dump` captures the running background server. Use this on the live server only when the operator explicitly asks.
- **Manual Snapshots**: Signal the process with `SIGUSR1` (`kill -USR1 <pid>`). Snapshots are written to the log directory.
- **CPU Profiles**: Signal the process with `SIGPROF` (`kill -PROF <pid>`) to start a 10-second profile.
- **Analysis**: Load `.heapsnapshot` or `.cpuprofile` in Chrome DevTools. Use tooling under `/tmp/opencode` for command-line analysis.

## Debugger

- **Bun Inspector**: Launch the CLI entrypoint through `termctrl` with `--inspect=ws://localhost:6499/`.
- **Pause**: Use `--inspect-wait` or `--inspect-brk` to pause until a debugger attaches.
- **Logs**: `termctrl logs <session>` surfaces inspector output.

## Verification

- Run `bun typecheck` from `packages/cli` or `packages/tui` after changes.
- Run `bun test` from `packages/tui` for shared TUI changes.
- For user-visible changes: verify initial render, interaction, and Ctrl-C exit.
