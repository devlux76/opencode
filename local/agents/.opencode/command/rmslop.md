---
description: Remove AI code slop from this branch's changes
---

Review `git diff $(git merge-base HEAD local)` and remove slop this branch introduced. Only touch lines the branch added or changed.

Slop is anything a careful maintainer of that file would not have written:

- comments that narrate what the code does, restate a name, or differ in tone and density from the rest of the file
- defensive checks, try/catch or fallbacks on paths whose inputs are already validated or typed
- `any`, `as` casts and `@ts-ignore` added to get past the checker
- errors swallowed into defaults without logging their cause
- helpers, options or abstractions used once, and code that was never called
- emoji, and style that does not match the file

Afterwards run the typecheck and the tests of each package you touched. Report in one to three sentences what you removed.
