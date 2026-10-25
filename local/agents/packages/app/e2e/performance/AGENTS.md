# packages/app/e2e/performance (benchmarks)

- Benchmarks measure; they never decide correctness. Assert only that the scenario completed and the metrics were collected, never a machine-dependent threshold.
- This machine is an old laptop under load: run benchmarks one at a time, against a production build, with nothing else heavy running, and compare before/after on the same machine in the same session.
- Use Playwright to drive the scenario and Chrome performance traces for profiling. Add a custom probe only for a measurement the trace cannot give.
- Keep raw results (or a lossless form) so a later reader can recompute.
- The Electron (desktop) profiling path no longer applies: the desktop app was removed from our fork.
