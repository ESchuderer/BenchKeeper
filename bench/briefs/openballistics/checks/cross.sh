#!/bin/sh
# Cross-step checks of step <k> (the name of <out-dir>, k >= 2) on a copy of <workspace>, against the previous step's
# snapshot (cross.mjs): the CI of the previous step, a CHANGELOG entry, a version bump per step 1's strategy. Merged
# into <out-dir>/checks.json after the step's own checks. Exit 0 when the checks ran, whatever their result.
# Usage: bench/briefs/openballistics/checks/cross.sh <workspace> <out-dir> <previous-step-snapshot>
set -eu
here=$(dirname "$(realpath "$0")"); scorer=$(realpath "$here/../../../scorer")
ws=$(realpath "$1"); out=$(realpath -m "$2"); prev=$(realpath "$3"); mkdir -p "$out"
NODE=docker.io/library/node:22.23.3-bookworm@sha256:0e5f906573693feaa1e21057ebdcfdb5bd5021f050b2dc7c9deceb629c7da2a8
copy=$(mktemp -d) && state=$(mktemp -d); trap 'rm -rf "$copy" "$copy.json" "$state"' EXIT
trap 'exit 130' INT TERM HUP
tar -C "$ws" --exclude=node_modules -cf - . | tar -C "$copy" -xf -
mounts() { echo "-v $copy:/ws:Z -v $state:/state:Z -v $prev:/prev:ro,z -v $scorer:/scorer:ro,z -v $here:/checks:ro,z"; }
# The CI's install commands with the network, every other CI command without it.
# shellcheck disable=SC2046 # mounts prints several flags
podman run --rm --timeout 900 --userns=keep-id -e HOME=/tmp -e CI=1 $(mounts) "$NODE" node /checks/cross.mjs install >&2 || true
# shellcheck disable=SC2046
podman run --rm --timeout 3000 --network none --userns=keep-id -e HOME=/tmp -e CI=1 -e K="$(basename "$out")" $(mounts) "$NODE" \
  node /checks/cross.mjs run > "$copy.json"
if [ -f "$out/checks.json" ]; then jq -s '{checks: (.[0].checks + .[1].checks)}' "$out/checks.json" "$copy.json"; else cat "$copy.json"; fi > "$out/checks.json.tmp"
mv "$out/checks.json.tmp" "$out/checks.json"
