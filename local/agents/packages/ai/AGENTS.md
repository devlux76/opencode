# packages/ai

One model call over HTTP: provider routes, protocols, request/response codecs and the canonical data model. The repository-wide rules are in the root `AGENTS.md`.

- `LLM.stream` / `LLM.generate` perform exactly one model call. Sessions, auth, permissions, plugins and retries across calls belong in `packages/core`.
- The Schema classes in `src/schema/` are the data model. Do not add a parallel shape or a second way to construct one.
- A new provider composes existing protocols with `Route.make(...)` (`src/route/`, `src/protocols/`) instead of copying one.
- Providers change without notice. Accept unknown string options (`Known | (string & {})`) and ignore unknown event types or enum values rather than failing the request. Fail only on a malformed known shape or a missing terminal event, with the provider's message in the error.
- Use Effect `HttpClient`, `Stream` and Schema codecs. Promises appear only in `src/promise.ts`, the Promise facade.
- Tests: `bun test --timeout 30000 <file>` from this directory. Provider tests replay recorded HTTP exchanges in `test/fixtures/recordings/` and need no keys. To re-record one, unset `CI` and run with `RECORD=true` and that provider's key; commit only the recording you meant to change.
- We use the `opencode` (Zen and Go) and `ollama-cloud` providers. Code for providers we never call is a candidate for removal, not for maintenance.
