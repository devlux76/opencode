#!/bin/bash
# Regression: opencode-update helpers must not end the run silently under set -euo pipefail.
set -euo pipefail
S="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/bin/opencode-update"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
source "$S"
status() { echo "STATUS $2: $3"; }

echo "--- prune with only the current release"
mkdir -p "$T/root/releases/v1"; ln -sfn releases/v1 "$T/root/current"
prune "$T/root"; echo "prune survived"

echo "--- rollback with no previous release (expected: message + exit 1)"
( rollback "$T/root" ) && echo "UNEXPECTED success" || echo "rollback refused (exit $?)"

echo "--- merge with a policy file that does not exist"
cd "$T"; git init -q -b dev up; cd up; git config user.email t@t; git config user.name t
printf 'v1\n' > code.txt; git add .; git commit -qm init
cd "$T"; git clone -q up fork; cd fork; git config user.email t@t; git config user.name t
git remote rename origin upstream; git checkout -qb local
mkdir -p local/agents; printf 'ours\n' > local/agents/AGENTS.md; git add -f local; git commit -qm policy
cd "$T/up"; printf 'v2\n' > code.txt; git commit -qam up2
cd "$T/fork"; git fetch -q upstream dev
merge_upstream "$T/fork" "$T"; echo "merge survived: code.txt=$(cat code.txt)"

echo "--- upstream edits and adds under a path we removed"
cd "$T/up"; mkdir -p site; printf 'site v1\n' > site/index.txt; git add site; git commit -qm "add site"
cd "$T/fork"; git fetch -q upstream dev; merge_upstream "$T/fork" "$T"
printf 'site\n' > local/removed-paths.txt; git rm -rq site; git add local; git commit -qm "remove site"
cd "$T/up"; printf 'site v2\n' > site/index.txt; printf 'new\n' > site/new.txt; git add site; git commit -qm "site v2"
cd "$T/fork"; git fetch -q upstream dev; merge_upstream "$T/fork" "$T"
if [[ -e site || -n "$(git ls-files site)" ]]; then echo "FAIL: site came back"; exit 1; fi
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then echo "FAIL: tree dirty"; exit 1; fi
echo "removed path stayed removed"

echo "--- upstream adds a new agent guide"
cd "$T/up"; mkdir -p pkg; printf 'slop\n' > pkg/AGENTS.md; git add pkg; git commit -qm "add guide"
cd "$T/fork"; git fetch -q upstream dev; merge_upstream "$T/fork" "$T"
if [[ -e pkg/AGENTS.md || -n "$(git ls-files pkg/AGENTS.md)" ]]; then echo "FAIL: upstream guide kept"; exit 1; fi
echo "upstream guide dropped"

echo "--- our versioned guides are installed as links and survive the merge"
if [[ -n "$(git ls-files local/agents/AGENTS.md)" && -L AGENTS.md && "$(cat AGENTS.md)" == ours ]]; then echo "guide installed"; else echo "FAIL: guide not installed from local/agents"; exit 1; fi
if [[ -n "$(git status --porcelain)" ]]; then echo "FAIL: installed policy shows in git status"; git status --porcelain; exit 1; fi

echo "--- upstream edits a guide we version"
cd "$T/up"; printf 'theirs\n' > AGENTS.md; git add AGENTS.md; git commit -qm "root guide"
cd "$T/fork"; git fetch -q upstream dev; merge_upstream "$T/fork" "$T"
if [[ -n "$(git ls-files AGENTS.md)" || "$(cat AGENTS.md)" != ours ]]; then echo "FAIL: upstream root guide won"; exit 1; fi
echo "ours kept"

echo "--- a guide edited in place as a real file is left alone"
rm AGENTS.md; printf 'local edit\n' > AGENTS.md
install_policy | grep -q 'AGENTS.md differs' || { echo "FAIL: drift not reported"; exit 1; }
if [[ -L AGENTS.md || "$(cat AGENTS.md)" != "local edit" ]]; then echo "FAIL: in-place edit clobbered"; exit 1; fi
echo "drift reported, file kept"
rm AGENTS.md; install_policy >/dev/null

echo "--- upstream .opencode stays removed; ours is installed"
cd "$T/up"; mkdir -p .opencode/command; printf 'push it\n' > .opencode/command/commit.md; git add .opencode; git commit -qm "upstream opencode dir"
cd "$T/fork"; git fetch -q upstream dev; merge_upstream "$T/fork" "$T"
printf '.opencode\n' >> local/removed-paths.txt; git rm -rq .opencode
mkdir -p local/agents/.opencode; printf '{}\n' > local/agents/.opencode/opencode.jsonc; git add -f local; git commit -qm "our opencode dir"
cd "$T/up"; printf 'push harder\n' > .opencode/command/commit.md; git commit -qam "edit"
cd "$T/fork"; git fetch -q upstream dev; merge_upstream "$T/fork" "$T"
if [[ -e .opencode/command/commit.md || -n "$(git ls-files .opencode)" ]]; then echo "FAIL: upstream .opencode came back"; exit 1; fi
if [[ ! -L .opencode/opencode.jsonc ]]; then echo "FAIL: our .opencode config not installed"; exit 1; fi
mkdir -p .opencode/node_modules; printf 'x\n' > .opencode/node_modules/generated.txt
if [[ -n "$(git status --porcelain)" ]]; then echo "FAIL: tree not clean"; git status --porcelain; exit 1; fi
echo "upstream .opencode removed, ours installed"

echo "--- an unrelated merge conflict leaves our linked policy in place"
printf 'local edit\n' > code.txt; git commit -qam "local edit"
cd "$T/up"; printf 'upstream edit\n' > code.txt; git commit -qam "upstream edit"
cd "$T/fork"; git fetch -q upstream dev
if (merge_upstream "$T/fork" "$T"); then echo "FAIL: expected a merge conflict"; exit 1; fi
if [[ ! -L AGENTS.md || "$(cat AGENTS.md)" != ours ]]; then echo "FAIL: linked AGENTS.md lost after a failed merge"; exit 1; fi
echo "policy link survived the conflict"

echo "--- a release gets our plugins' declared files, nothing else"
mkdir -p "$T/plugsrc/packages/plugins/grounding/test"
printf '{"files": ["package.json", "index.ts"]}\n' > "$T/plugsrc/packages/plugins/grounding/package.json"
printf 'export default 1\n' > "$T/plugsrc/packages/plugins/grounding/index.ts"
printf 'test\n' > "$T/plugsrc/packages/plugins/grounding/test/x.test.ts"
install_plugins "$T/plugsrc" "$T/release"
if [[ "$(cd "$T/release/plugins/grounding" && find . -type f | sort | tr '\n' ' ')" != "./index.ts ./package.json " ]]; then
  echo "FAIL: release plugin files wrong: $(find "$T/release" -type f)"; exit 1
fi
echo "plugin installed into the release"
echo ALL_OK
