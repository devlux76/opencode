# Trailblazer grounding (ours)

Grounds OpenCode in Trailblazer's code graph so that weaker models start from facts. Designed with Codex (VORTEX, 2026-10-24). The verifier (`verify.ts`) follows Codex's contract.

## What it does

- **Before the first model call of each task** (the `context` hook, primary requests only), asks Trailblazer for a trail of the task's prompt against the session's git repository, bounded by `trailMs`. If the trail fails or is slow, it uses `search` plus `where` on up to 6 names the prompt mentions instead (at most 20 locations), labelled degraded. One deadline, `totalMs`, bounds both together: the fallback gets only what the trail left. If nothing answers in time, the block says grounding is unavailable.
- **The block** (`<trailblazer-grounding task=… repo=… source=…>`) is labelled as candidates to verify. It goes just before the task's prompt on every request of that task. It is never persisted: a stored message is replayed as new input and costs a model turn. Trailblazer is asked once per task.
- **Tools**, offered directly (not only through codemode): `trailblazer_where`, `trailblazer_uses`, `trailblazer_impact`, `trailblazer_read`.
- **Evidence check** (`verify.ts`): after a grounded run succeeds, the run's explicit `path:first-last` citations (at most 40) are looked up in the repository as it is now. Each one is reported as missing, outside the repository (symlinks included), or an impossible range. If anything is wrong, a `<trailblazer-evidence-check>` note goes in before the session's next task, for that task's turns only, and is logged. It is never posted into the session: anything admitted as a run ends is drained as new input and costs a model turn. It is advisory. It says plainly that a range that exists does not prove the claim about it, and it cannot tell whether a file changed after the model read it.

## Options (plugin entry `options`)

`budgetTokens` (3000), `trailMs` (300000: a trail is worth waiting for; the bound only catches a hung Trailblazer, and one that is down fails at once), `lightMs` (3000), `totalMs` (310000), `endpointFile` (default `$TRAILBLAZER_STATE_DIR/endpoint.json` or `~/.local/share/trailblazer/endpoint.json`).

## Tests

- `bun test` here (also run daily from `local/tests.txt`).
- `bun run script/smoke.ts`: a real server from this checkout on a random port with scratch data, a fake Trailblazer and a fake model. It loads the plugin from a bare copy of the `files` in `package.json`, as deployed. It never touches the live server or its database.

## Deployment

`opencode-update` copies the `files` listed in `package.json` into `<release>/plugins/grounding/`. To enable the plugin, list `~/.local/share/opencode-local/current/plugins/grounding` (the directory) under `plugins` in the global config. That is a separate step, taken once both halves (this and Codex's verifier) are tested.
