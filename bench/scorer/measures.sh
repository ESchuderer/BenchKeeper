#!/bin/sh
# Cheap measures of one cartridges trial: types.json, coverage.json, print.json, html.json, docs.json in <out-dir>.
# The workspace is mounted read-only, no network while measuring; the Nu HTML Checker (vnu) and Chromium run in their own images.
# Usage: bench/scorer/measures.sh <workspace> <out-dir> [brief.md]
set -eu
ws=$(realpath "$1"); out=$(realpath -m "$2"); here=$(dirname "$(realpath "$0")")
brief=$(realpath "${3:-$here/../briefs/cartridges/brief.md}")
NODE=docker.io/library/node:22.23.3-bookworm-slim@sha256:efd0ab5780c2d9ab1f0f869571a00d5edb17793bff4cce4a2792e3eb0ffc7562
PW=mcr.microsoft.com/playwright:v1.64.0-noble@sha256:bc72a8df40831ded821e3cbc79c318c21b44d6e51dff9fd89ace7a8249c5b462
VNU=ghcr.io/validator/validator@sha256:b0d8bc283eaaa178d3b4bbc10c707e1126bd69bfccd469dc90026ba1befc30b1
mkdir -p "$out"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
[ ! -f "$ws/index.html" ] || cp "$ws/index.html" "$tmp/index.html"
run="podman run --rm --network none --userns=keep-id -e HOME=/tmp"

# Print view of the 25 detail views; the rendered 308 Win. page goes to $tmp/detail.html.
$run --ipc=host --timeout 600 -v "$ws":/app:ro,Z -v "$here":/s:ro,Z -v "$brief":/brief.md:ro,Z -v "$tmp":/o:Z -w /s "$PW" \
  node print.mjs /app /brief.md /o/detail.html > "$out/print.json"
# Nu HTML Checker over index.html and the rendered detail page (exit code 1 when it reports errors).
# Without index.html there is nothing to check: html.json then has null counts (missing in the final score).
if [ -f "$tmp/index.html" ]; then
  $run --timeout 300 -v "$tmp":/o:Z "$VNU" vnu --format json --stdout /o/index.html $( [ -f "$tmp/detail.html" ] && echo /o/detail.html ) \
    > "$tmp/vnu.json" 2> /dev/null || true
else
  echo '{"version":null,"messages":[],"missing":"no index.html"}' > "$tmp/vnu.json"
fi
$run --timeout 900 -v "$ws":/app:ro,Z -v "$here":/s:ro,Z -v "$tmp":/o:ro,Z -w /s "$NODE" sh -c '
  node types.mjs /app && echo ---- && node coverage.mjs /app && echo ---- && node docs.mjs /app && echo ---- && node html.mjs /o/vnu.json' \
  | awk -v d="$out" 'BEGIN{n=1; split("types coverage docs html",f," ")} /^----$/{n++; next} {print > (d "/" f[n] ".json")}'
