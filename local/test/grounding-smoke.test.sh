#!/bin/bash
# The grounding plugin in a real server built from this checkout, on scratch only (random port,
# scratch XDG dirs, fake Trailblazer and model): catches upstream plugin API changes before deploy.
set -euo pipefail
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/packages/plugins/grounding"
cd "$dir"
"${BUN:-$HOME/.bun/bin/bun}" run script/smoke.ts
