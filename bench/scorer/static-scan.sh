#!/bin/sh
# Static scan (ESLint, scorer's own config) of an app's own source. The workspace is mounted read-only, no network.
# Usage: bench/scorer/static-scan.sh <workspace> <out-dir>   writes static-scan.json
set -eu
ws=$(realpath "$1"); out=$(realpath -m "$2"); here=$(dirname "$(realpath "$0")")
NODE=docker.io/library/node:22.23.3-bookworm-slim@sha256:efd0ab5780c2d9ab1f0f869571a00d5edb17793bff4cce4a2792e3eb0ffc7562
mkdir -p "$out"
podman run --rm --network none --userns=keep-id -e HOME=/tmp -v "$ws":/app:ro,Z -v "$here":/s:ro,Z -v "$out":/out:Z -w /s "$NODE" \
  node static-scan.mjs /app /out
