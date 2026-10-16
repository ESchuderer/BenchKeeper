#!/bin/sh
# A targeted task's checks on a copy of <workspace>: builds the baseline (prepare.sh, mounted read-only at /base), runs
# <brief>/checks/checks.mjs through run.mjs in the node container without network; the task folder is not mounted, the
# files of <brief>/checks/mutants/ go in on stdin (run.mjs) (30 minutes: above 120 s for each of
# up to 15 checks); writes <out-dir>/checks.json.
# Exit 0 when the checks ran, whatever their result.
# Usage: bench/briefs/skill-common/checks.sh <brief-dir> <workspace> <out-dir>
set -eu
here=$(dirname "$(realpath "$0")"); brief=$(realpath "$1"); ws=$(realpath "$2"); out=$(realpath -m "$3"); mkdir -p "$out"
NODE=docker.io/library/node:22.23.3-bookworm@sha256:0e5f906573693feaa1e21057ebdcfdb5bd5021f050b2dc7c9deceb629c7da2a8
copy=$(mktemp -d); base=$(mktemp -d); trap 'rm -rf "$copy" "$base"' EXIT
trap 'exit 130' INT TERM HUP
tar -C "$ws" --exclude=node_modules -cf - . | tar -C "$copy" -xf -
"$brief/prepare.sh" "$base" > /dev/null
# {"mutants/<file>": "<content>"}
hidden() { (cd "$brief/checks" && find mutants -type f 2> /dev/null | sort | while read -r f; do jq -Rs --arg p "$f" '{($p): .}' "$f"; done) | jq -s 'add // {}'; }
hidden | podman run -i --rm --network none --timeout 1800 --userns=keep-id -e HOME=/tmp -v "$copy":/ws:ro,Z -v "$base":/base:ro,Z \
  -v "$here/run.mjs":/common/run.mjs:ro,z -v "$brief/checks/checks.mjs":/checks.mjs:ro,z "$NODE" node /common/run.mjs > "$out/checks.json.tmp"
mv "$out/checks.json.tmp" "$out/checks.json"
