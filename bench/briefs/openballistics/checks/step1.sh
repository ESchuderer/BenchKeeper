#!/bin/sh
# Step 1 checks (repository setup) on a copy of <workspace>; writes <out-dir>/checks.json (ids S1-*, see step1.mjs).
# Exit 0 when the checks ran, whatever their result. Needs bench/scorer/node_modules (`npm ci` in bench/scorer).
# Usage: bench/briefs/openballistics/checks/step1.sh <workspace> <out-dir>
set -eu
here=$(dirname "$(realpath "$0")"); scorer=$(realpath "$here/../../../scorer")
ws=$(realpath "$1"); out=$(realpath -m "$2"); mkdir -p "$out"
[ -f "$scorer/node_modules/yaml/package.json" ] || { echo "step1: bench/scorer/node_modules/yaml missing" >&2; exit 1; }
NODE=docker.io/library/node:22.23.3-bookworm@sha256:0e5f906573693feaa1e21057ebdcfdb5bd5021f050b2dc7c9deceb629c7da2a8
ACTIONLINT=docker.io/rhysd/actionlint:1.7.7@sha256:1d74bfc9fd1963af8f89a7c22afaaafd42f49aad711a09951d02cb996398f61d
copy=$(mktemp -d); trap 'rm -rf "$copy"' EXIT
tar -C "$ws" --exclude=node_modules --exclude=dist -cf - . | tar -C "$copy" -xf -
rm -f "$out/actionlint.txt" "$out/actionlint.exit"
if ls "$copy"/.github/workflows/*.y*ml > /dev/null 2>&1; then
  set +e
  podman run --rm --network none --userns=keep-id -v "$copy":/repo:ro,Z -w /repo "$ACTIONLINT" -no-color > "$out/actionlint.txt" 2>&1
  echo $? > "$out/actionlint.exit"
  set -e
fi
podman run --rm --network none --userns=keep-id -e HOME=/tmp -v "$copy":/ws:Z -v "$scorer":/scorer:ro,Z \
  -v "$here":/checks:ro,Z -v "$out":/out:ro,Z "$NODE" node /checks/step1.mjs > "$out/checks.json.tmp"
mv "$out/checks.json.tmp" "$out/checks.json"
