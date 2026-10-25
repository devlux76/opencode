# packages/tui

The terminal UI (OpenTUI + Solid) launched by the `opencode` command. The repository-wide rules are in the root `AGENTS.md`.

- Data comes from `@opencode/client` through the location-scoped context in `src/context/data.tsx`.
- Opt-in experiments go in the `experiments` registry in `src/component/dialog-experiments.tsx`, gated by the matching `config.experimental` key. To adopt one, remove its entry and gate; to drop one, remove its entry, gate and code. The registry and dialog stay even when empty.
- Choose theme tokens by meaning (feedback, form field, action). If a role is missing, add it to the theme schema and defaults instead of borrowing a similar-looking token.
- Check layout at narrow and wide terminal sizes.
- Tests: `bun test --timeout 30000 <file>`.
