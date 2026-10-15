#!/bin/sh
# Copies a run's results into bench/results/<name>/: manifest, and per trial trial.json, the transcript,
# the built app (app.tar.gz, without node_modules), the scorer's screenshots and the app review (review.json).
# Refuses when the token is unavailable or appears in any file, including the apps' git history.
# Usage: bench/publish.sh <run-dir> <name>
set -eu
run=$(realpath "$1"); results=$(dirname "$(realpath "$0")")/results; out=$results/$2
mkdir -p "$results"
# Both credentials are searched for: the subscription token (Claude Code arms) and the API key (OpenCode arms).
token=${CLAUDE_CODE_OAUTH_TOKEN:-$(cat "$HOME/.config/benchkeeper/oauth-token" 2>/dev/null || true)}
key=${ANTHROPIC_API_KEY:-$(cat "$HOME/.config/benchkeeper/anthropic-api-key" 2>/dev/null || true)}
[ -n "$token" ] || { echo "no token to scan for: set CLAUDE_CODE_OAUTH_TOKEN or write ~/.config/benchkeeper/oauth-token" >&2; exit 1; }
found() { grep -aqF -- "$token" "$1" || { [ -n "$key" ] && grep -aqF -- "$key" "$1"; }; }
tmp=$(mktemp -d "$results/.publish-XXXXXX") && trap 'rm -rf "$tmp"' EXIT
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
rm -rf "$out" && mv "$tmp" "$out" && trap - EXIT
du -sh "$out"
