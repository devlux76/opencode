# packages/core/src/tool

`src/tool.ts` owns the Location-scoped tool service: registrations, effective lookup, execution and outcomes. This folder holds its runtime helpers; built-in tools are in `plugin/`. The repository-wide rules are in the root `AGENTS.md`.

## Shape

- A tool is one object: name, options, `input`/`output` schemas and its executor. There is one kind of executable entry; do not add a second.
- Built-ins, plugins and MCP all register through `Tool.Service.transform`. The latest active registration for a name wins; disposing a registration rebuilds from the rest and reveals what it overrode. MCP keeps one transform and reloads it when its tool list changes.
- A namespace flattens model-facing names to `<namespace>_<tool>`. Tools default into code mode (`codemode: false` keeps one on the provider's native tool list).
- Type safety ends at registration: the registry stores `Tool.Info` and validates input and output at runtime. The `any` at that internal boundary is deliberate.
- `Tool.Service` is per Location. Do not make it process-global.

## Execution and errors

- The registry does no authorization. Each tool's executor (the leaf) owns permission checks, resolution and the order of side effects; Location services are acquired when the layer is built.
- Translate only expected, typed errors into `ToolFailure`. Never `catchCause`: interruption and defects must propagate. A user decline (`Permission.assert`) travels as a defect and is surfaced by the session runner; a decline with feedback (`Permission.CorrectedError`) stays typed so the model can continue.
- Built-ins return complete responses; the session runner bounds output afterwards. The shell tool keeps full output in a file and returns a bounded tail plus its path.

## Our changes

- `plugin/shell.ts`: `OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS` sets the foreground default (test in `local/tests.txt`).
- Tests: `bun test --timeout 30000 test/<file>` from `packages/core`.
