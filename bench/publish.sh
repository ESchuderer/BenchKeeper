#!/bin/sh
# Copies a run's results into bench/results/<name>/: manifest, and per trial trial.json, the transcript,
# the built app (app.tar.gz, without node_modules), the scorer's screenshots and the app review (review.json).
# Refuses when the token is unavailable or appears in any file, including the apps' git history.
# Usage: bench/publish.sh <run-dir> <name>
set -eu
run=$(realpath "$1"); results=$(dirname "$(realpath "$0")")/results; out=$results/$2
mkdir -p "$results"
# Every credential is searched for: the environment's token and key, and every file in ~/.config/benchkeeper
# (subscription tokens of each account used, the API key). The patterns stay in a private temp file, off the command line.
tmp=$(mktemp -d "$results/.publish-XXXXXX") && pats=$(umask 077 && mktemp) && trap 'rm -rf "$tmp" "$pats"' EXIT
for v in "${CLAUDE_CODE_OAUTH_TOKEN:-}" "${ANTHROPIC_API_KEY:-}"; do [ -z "$v" ] || printf '%s\n' "$v" >> "$pats"; done
for f in "$HOME"/.config/benchkeeper/*; do [ ! -f "$f" ] || tr -d '\r' < "$f" | grep -v '^[[:space:]]*$' >> "$pats" || true; done
[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] || ls "$HOME"/.config/benchkeeper/oauth-token* > /dev/null 2>&1 \
  || { echo "no subscription token to scan for: set CLAUDE_CODE_OAUTH_TOKEN or write ~/.config/benchkeeper/oauth-token" >&2; exit 1; }
# OpenCode trials ran on the API key: without it the scan would miss that credential.
if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ ! -s "$HOME/.config/benchkeeper/anthropic-api-key" ] \
  && cat "$run"/round-*/*/trial.json 2>/dev/null | jq -se 'any(.[]; .outcome.runtime == "opencode")' > /dev/null; then
  echo "run has OpenCode trials but no API key to scan for: set ANTHROPIC_API_KEY or write ~/.config/benchkeeper/anthropic-api-key" >&2; exit 1
fi
found() { grep -aqF -f "$pats" -- "$1"; }
cp "$run/manifest.txt" "$tmp/"
for t in "$run"/round-*/*/; do
  [ -f "$t/trial.json" ] || continue
  objs=$tmp/objects.bin
  podman run --rm --userns=keep-id -v "$t/workspace":/w:ro,Z benchkeeper-arm-a sh -c \
    'find /w -name .git -type d -prune | while read -r g; do git -c safe.directory="*" --git-dir="$g" cat-file --batch-all-objects --batch || exit 1; done' > "$objs" \
    || { echo "git object scan failed for $t" >&2; exit 1; }
  if found "$objs"; then echo "credential in the git objects of $t" >&2; exit 1; fi
  rm -f "$objs"
  d=$tmp/$(basename "$(dirname "$t")")/$(basename "$t") && mkdir -p "$d"
  cp "$t/trial.json" "$d/" && gzip -9 -c "$t/transcript.jsonl" > "$d/transcript.jsonl.gz"
  [ ! -f "$t/score/app.tar.gz" ] || cp "$t/score/app.tar.gz" "$d/"
  [ ! -d "$t/score/screenshots" ] || cp -r "$t/score/screenshots" "$d/"
  [ ! -f "$t/review.json" ] || cp "$t/review.json" "$d/"
done
for f in $(find "$tmp" -type f); do
  case $f in *.gz) zcat "$f" > "$tmp/.plain" && found "$tmp/.plain" ;; *) found "$f" ;; esac && { echo "credential found in ${f#$tmp/}" >&2; exit 1; }
  rm -f "$tmp/.plain"
done
rm -rf "$out" && mv "$tmp" "$out" && rm -f "$pats" && trap - EXIT
du -sh "$out"
