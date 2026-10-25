# AGENTS.md

Instructions for any agent (Claude, Codex, OpenCode) working in this repository.

## What this repository is

This is our own OpenCode, forked from `anomalyco/opencode`. Our branch is `local`; upstream's main line is `dev`, merged into `local` daily by `local/bin/opencode-update`. We are stripping it down and customizing it for our own use.

- Nothing goes upstream. The furthest anything is pushed is our fork, `origin` (`devlux76/opencode`). Never open a PR, issue or push against `upstream`. If something seems worth offering upstream (a security fix, a broadly useful feature), say so to the operator and stop there.
- Agent guides (`AGENTS.md` at any level) and the project OpenCode config (`.opencode/`) are ours. Each is versioned at `local/agents/<path>` and installed at `<path>` as an untracked link by `opencode-update`, so editing the file in place edits the versioned copy. Commit such edits under `local/agents/` (`git add -f`: `.git/info/exclude` ignores `AGENTS.md`). A new guide or `.opencode` file is created under `local/agents/` and installed with `opencode-update --policy`. Upstream's `.opencode/` is removed (`local/removed-paths.txt`).
- `DIRECTION.md` belongs to the operator. Do not edit it.
- `local/` holds our tooling and deployment (see `local/README.md`). Upstream never touches it.

## Workflow

- Work in a git worktree branched from `local` (`.claude/worktrees/<short-name>`), never directly in the main checkout. Fast-forward `local` when the work is verified, then remove the worktree.
- Keep `local` linear and never rewrite its history: no force-push, no rebase of published commits. Merges from upstream happen only through `opencode-update`.
- Every change we make to upstream code gets a test, and that test gets a line in `local/tests.txt` so the daily update proves our patches still hold after each merge.
- Prefer small, separate commits for separate concerns. Commit messages follow the repository rules below: one short imperative summary (prefix `local:` when the change exists only in our fork) citing `bug:<id>`; the why goes in the bug.
- Deleting code is welcome. When removing a feature, remove its tests, config, docs and dead dependencies in the same change, and confirm nothing else imports it (`trailblazer uses NAME` or a typecheck).
- Dependencies: before adding one, prefer the platform (Bun, Node built-ins, Effect). A dependency that could be reimplemented in under ~10K lines is a candidate to drop and reimplement in-tree. Pin exact versions in `package.json`; commit `bun.lock`.

## Build, test, check

- Runtime and package manager: Bun, at the version in the root `package.json` `packageManager` field. Install with `bun install` at the root.
- Typecheck a package from its directory: `bun run typecheck`. Do it for every package you touch. `bun check` is the local checker; `bun run typecheck:tsc` (the official compiler) is the tie-breaker when they disagree.
- Tests run from a package directory, never the repo root: `cd packages/<pkg> && bun test --timeout 30000 <file>`. Run the focused tests while iterating and the package's whole suite before merging.
- Build the CLI binary through `local/bin/opencode-update --build-only` (tests, builds, smoke-tests and installs). For a throwaway build only: `cd packages/cli && OPENCODE_CHANNEL=local bun run script/build.ts --single`, then `git checkout -- .` (the build reorders manifests).
- After changing the public Protocol or Server HTTP API, run `bun run generate` in `packages/client`. Never hand-edit generated files.

## Architecture boundaries

- Runtime dependencies point one way: `schema` -> `core` and `protocol` -> `server`. `client` may depend on `schema` and `protocol`, never on `core` or `server`. `cli` composes the rest.
- The database is SQLite through Drizzle (`packages/core/src/database`). Sessions are event-sourced: durable events record only irreducible facts; projections derive the rest. Keep it that way.
- Session execution is process-local and keyed by Session ID; tools, permissions and the filesystem are scoped to a Location. Read `packages/core/src/session*` before changing execution, and keep one LLM call per step.

## TypeScript

- Strict types. No `any`, no `as` casts to silence the checker, no `@ts-ignore`. Use `unknown` at boundaries and narrow it once.
- Validate data where it enters (HTTP, files, environment, model output, plugin input) with Effect `Schema`, then pass typed values inward. Do not re-validate typed values.
- Errors are values. Use typed errors (`Schema.TaggedError` / `Data.TaggedError`) for expected failures and let defects be defects. Never swallow an error into `undefined` or a default without logging it with its cause: silent fallbacks have cost us hours (a credential that loaded no models, for example).
- No floating promises; every promise is awaited or explicitly handed to something that owns it.
- Prefer `const`, pure functions and immutable data. Keep side effects at the edges.
- Name things for what they mean in the domain. Comments explain why and record constraints that the code cannot show; do not narrate what the code does.
- Use Bun APIs (`Bun.file`, `Bun.spawn`, `bun:sqlite`) over Node equivalents where both exist.
- Formatting: follow the repository's oxlint/prettier configuration; do not reformat code you are not otherwise changing.

## Effect

- Model services as `Context` services provided by `Layer`s. In generators, bind a service to a name (`const store = yield* Store.Service`) and call methods on it.
- Wrap service methods in `Effect.fn("Service.method")` so traces and logs name them.
- Return an `Effect` only from code that performs effects. Parsing, validation and option building stay synchronous.
- Acquire resources with `Effect.acquireRelease` / scoped layers so they are released on interruption. Long-running fibers are forked into a scope, never detached without an owner.
- Design for events and messages. Do not poll or sleep in loops waiting for state; subscribe to the bus or the event that announces the change. A timeout is a backstop that reports an anomaly, not a control mechanism.
- Log with the structured logger, one event per line as it happens, with the identifiers needed to follow a request (session, location, call).

## TUI and web UI (Solid, OpenTUI)

- Components are pure functions of signals and props. No side effects during render; put them in effects or event handlers and clean them up (`onCleanup`).
- Derive state with memos instead of copying it into new signals.
- Choose theme tokens by semantic role. If the role is missing, add it to the theme schema and defaults instead of borrowing a token that happens to look right.
- Test narrow and wide terminal sizes when layout changes.

## Database and migrations

- Migrations are forward-only and never edited once committed. Every schema change ships with a migration and a test that runs it on a database in the old shape.
- The live database (`~/.local/share/opencode/opencode.db`) is the operator's history. Test anything that rewrites data against a copy (`sqlite3 db ".backup copy.db"`) with `OPENCODE_DB` or XDG paths pointed at the copy, never against the live file.
- Drizzle tables use snake_case field names so column names are not repeated as strings.

## Tests

- Test behaviour through the public surface of a module. Use real implementations (in-memory SQLite, temp directories, a local HTTP server) before mocks; mock only what you cannot run.
- Deterministic tests only: no sleeps or wall-clock races. Inject clocks, seams and events. A flaky test is a bug to fix, not to retry.
- For a bug fix, write the test that fails first, see it fail, then fix.
- Never weaken or delete a test to make a change pass without saying why in the commit.

## Shell scripts (`local/bin`)

- `#!/usr/bin/env bash` with `set -euo pipefail`; quote every expansion; `flock` anything that must not run twice.
- Idempotent: re-running after a failure is safe and resumes or redoes cleanly.
- Write files atomically (temp file + `mv`), log timestamped lines as they happen, and exit non-zero with a one-line reason on failure.

## Deployment

- The server is the user unit `opencode.service` (`opencode serve` on 127.0.0.1:4096) running `~/.local/share/opencode-local/current/opencode`. Deploy only through `opencode-update`; never copy binaries by hand. `opencode-update --rollback` returns to the previous release.
- Builds use channel `local` (no self-update) and version `<cli version>-local.<sha>`.
- Restart the server only when no session is running; never kill an agent's work to deploy.
- The server listens on loopback only and runs without a password (`OPENCODE_SERVER_AUTH=disabled` in `~/.config/opencode-local/server.env`; our patch refuses that setting on any non-loopback address). Never bind it to another address without first putting a password there. Secrets (`auth.json`, provider keys, any server password) never go into the repository, logs, prompts or commit messages.
- Other tools talk to this server: the VORTEX OpenCode adapter (`~/projects/vortex/skills/vortex/adapters/opencode.mjs`) and `~/.claude/skills/manage-opencode/oc.py`. A change to the HTTP API must keep them working or update them in the same piece of work.

## Repository rules (effective 2026-10-25)

- ISSUES = git-bug. File the bug before committing: `git bug bug new -t "..." -F file --non-interactive`. Labels are kanban columns: status:todo|doing|done, plus kind:*, severity:high|med|low, area:*. Bug refs stay local: the global pre-push refuses refs/bugs and refs/identities unless ALLOW_BUG_PUSH=1.
- COMMIT MESSAGE: whole message incl. trailers <=255 chars and must cite an EXISTING bug as `bug:<id>`; details go in the bug, not the message. Only git's automatic "Merge branch/remote-tracking branch '...'" messages are exempt.
- NO PRIVATE STRINGS anywhere (commits, bug text, files, PRs, notes): no Claude-Session lines or claude.ai links, no session ids, no names or e-mail addresses, no city/timezone, no /home/<user> paths, no project or persona names in commit messages. Pattern list: ~/.config/git/pii-patterns.
- IDENTITY devlux76 <devlux76@users.noreply.github.com>; commit dates are UTC (post-commit/post-merge hooks restamp). Global hooks in ~/.config/git/hooks (core.hooksPath) enforce all of this. Never use --no-verify.
- HISTORY: older SHAs are gone; cite files, docs or bug ids instead. Pushing is disabled for llama.cpp's origin and opencode's upstream remote; opencode pushes only to the operator's own fork.
- CROSS-REPO BUGS: defects that span repos or whose owner is unclear go in the shared git-bug tracker at ~/projects/.bugs (local only, no remote, no tracked files): `git -C ~/projects/.bugs bug bug new -F file --non-interactive`, first line of the file = title; labels project:<repo> plus kind/severity/status. Triage = open the per-repo bugs, comment their ids on the shared bug, close it when all parts close. Commits still cite a bug in their OWN repo; shared ids are not accepted by the commit hook.
