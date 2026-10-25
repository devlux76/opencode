# packages/codemode

A small, pure interpreter for a JavaScript-like language that models write to call tools ("code mode"); see `README.md`. The repository-wide rules are in the root `AGENTS.md`.

- Program values are `Value` (`src/interpreter/objects.ts`). Host values are `unknown` and enter only through `fromHost` (`src/interpreter/extensions.ts`) and `fromJson` (`src/data.ts`). Keep program-facing signatures typed as `Value`.
- Each built-in object kind is one `Obj` subclass (`Wrapper` or `Opaque`) overriding the hooks it needs. Ask the object; do not add `instanceof` ladders.
- The interpreter runs model-written code: it must stay pure and bounded. No host I/O except through registered tools.
- `interpreter-support.md` is the list of supported language features. Tick off what you add; add an unchecked item for a significant gap you find.
- Tests: `bun test` from this directory.
