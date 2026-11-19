#!/bin/sh
set -eu
arm=$1 model=$2 id=$3
repo=${REPO:?set REPO to this repository}
fixture=${FIXTURE:-/tmp/askmore-grill}
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
