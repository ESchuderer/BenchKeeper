#!/bin/sh
# The repository's own checks (`npm ci`, `npm test`: lint, build with type checking, mocha) on a copy of <workspace>, in
# the pinned node image, 10 minutes at most; writes <out-dir>/suite.json {"ok": bool, "exit": n}, the log on stdout.
# Exit 0 when the suite ran, whatever its result.
# Usage: bench/briefs/mistreevous/checks/suite.sh <workspace> <out-dir>
set -u
ws=$(realpath "$1"); out=$(realpath -m "$2"); mkdir -p "$out"
NODE=docker.io/library/node:22.23.3-bookworm-slim@sha256:efd0ab5780c2d9ab1f0f869571a00d5edb17793bff4cce4a2792e3eb0ffc7562
copy=$(mktemp -d); trap 'rm -rf "$copy"' EXIT
trap 'exit 130' INT TERM HUP
tar -C "$ws" --exclude=node_modules -cf - . | tar -C "$copy" -xf -
podman run --rm --timeout 600 --userns=keep-id -e HOME=/tmp -e CI=1 -v "$copy":/w:Z -w /w "$NODE" \
  sh -c 'npm ci --no-audit --no-fund && npm test' 2>&1
rc=$?
printf '{"ok":%s,"exit":%d}\n' "$([ "$rc" = 0 ] && echo true || echo false)" "$rc" > "$out/suite.json"
