# Our OpenCode fork

This branch (`local`) is our own OpenCode. Nothing here goes upstream; the
furthest anything is pushed is our fork, `devlux76/opencode`. Upstream's `dev`
(their main line) is merged in daily.

## Layout

- `local/bin/opencode-update`: sync the fork's `dev` from upstream, merge
  `upstream/dev` into `local`, run our patch tests and the typecheck, build,
  smoke-test, install, restart the server once it is idle, push `local` to the
  fork. `--build-only`, `--no-restart`, `--rollback`, `--policy` (only link
  the policy files below into place).
- `local/tests.txt`: tests for our patches, run before every build. Add one
  line per patch. `local/test/*.test.sh` (tests of our own tooling) run too.
- `local/agents/<path>`: our policy files (every `AGENTS.md`, the project
  `.opencode/`), versioned here and linked, untracked, to `<path>` after every
  merge; `.git/info/exclude` keeps the links out of `git status`. Editing a
  linked file edits the versioned copy; commit it (`git add -f`), or the next
  update refuses to run on a dirty tree. A real file in place that differs from
  ours is reported and left alone. Upstream's own copies are dropped by the merge.
- `local/systemd/`: user units. `opencode.service` (server on 127.0.0.1:4096),
  `opencode-update.service` + `.timer` (daily, 04:30).

## Deployment

- Releases: `~/.local/share/opencode-local/releases/<version>/opencode`, the
  live one through the `current` symlink. `~/.local/bin/opencode` and
  `~/.opencode/bin/opencode` point at `current/opencode`. The last three
  releases are kept.
- Builds use channel `local` (no self-update) and version
  `<cli version>-local.<sha>`; our patch makes compiled `local` builds use
  `opencode.db`, the same database as release builds.
- Server auth: `~/.config/opencode-local/server.env`, loaded by the unit, holds
  `OPENCODE_SERVER_AUTH=disabled`: the server binds 127.0.0.1 only and needs no
  password (our patch refuses that setting on any other address). To require
  one, put `OPENCODE_SERVER_PASSWORD=...` and `OPENCODE_PASSWORD=...` there
  instead; clients then send HTTP Basic auth, user `opencode`.
- Status and log: `~/.local/state/opencode-local/{status.json,update.log}`.
  Before a restart onto a new release the database is backed up to
  `~/.local/share/opencode-backups/daily` (last two kept).

## Our patches

- `packages/cli/src/database-path.ts`: compiled `local` builds share `opencode.db`.
- `packages/core/src/tool/plugin/shell.ts`: `OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS`
  raises the shell tool's two-minute foreground default.
- `packages/cli/src/local-auth.ts` + `packages/server/src/{process,middleware/authorization}.ts`:
  `OPENCODE_SERVER_AUTH=disabled` runs a loopback-bound server without a password.
- Removed packages: `local/removed-paths.txt`.

## Our plugins

- `packages/plugins/grounding`: grounds sessions in Trailblazer's code graph (see its
  README). `opencode-update` tests it, smoke-tests it in a scratch server
  (`local/test/grounding-smoke.test.sh`), and copies it into each release under
  `plugins/grounding`. It runs only once listed in the global config's `plugins`.

## When the daily update fails

Read `status.json` and `update.log`. A merge conflict outside the policy files
is left for a person: resolve it on `local` in `~/vendor/opencode`, commit,
then run `opencode-update --build-only`. The deployed release is untouched by
any failure.
