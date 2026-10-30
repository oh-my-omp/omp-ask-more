#!/bin/sh
# One recorded run: omp in the fixture project with the arm's tools, the stock 18.14.0 system
# prompt, no rules, context files or ambient plugins, and its session written to $RUNS/<run-id>.
# usage: run.sh <arm A|B|C|N|V1|V2|V3> <model> <run-id>
#   A, N  this plugin (REPO/index.ts); the A and N runs with REPO at commit e50dc7b, the R and RN
#         runs at commit e90586d, the S and SN runs at commit e73cd59, the T and TN runs at commit
#         96b4cd5 (the openai-codex T2 runs at e0394c5, which declared strict: false), the U runs at
#         79c65cc, with the parameters written for strict tool calling, and the W runs at the
#         current field descriptions, which open with the value each field expects
#   B  no ask tool      C  omp's native ask
#   V1..V3  a copy of this plugin with variants/<n>-*.diff applied, at /tmp/askmore-v<n>
set -eu
arm=$1 model=$2 id=$3
repo=${REPO:?set REPO to this repository}
fixture=${FIXTURE:-/tmp/askmore-grill}   # docs/skill-priority/fixture copied there, SKILL.md at .omp/skills/grilling/
runs=${RUNS:-/tmp/askmore-grill-runs}
tpl=$repo/node_modules/@oh-my-pi/pi-coding-agent/src/prompts/system/system-prompt.md
mkdir -p "$runs/$id"
: >"$runs/EMPTY.md"
set -- --no-extensions --skills=grilling --no-rules --no-context-files \
	--system-prompt-template "$tpl" --append-system-prompt "$runs/EMPTY.md" \
	--session-dir "$runs/$id" --model "$model"
case $arm in
	A | N) set -- "$@" -e "$repo/index.ts" --tools=ask,read ;;
	B) set -- "$@" --tools=read ;;
	C) set -- "$@" --tools=ask,read ;;
	V1 | V2 | V3) set -- "$@" -e "/tmp/askmore-$(echo "$arm" | tr V v)/index.ts" --tools=ask,read ;;
	*) echo "unknown arm $arm" >&2; exit 2 ;;
esac
cd "$fixture"
exec omp "$@"
