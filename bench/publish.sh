#!/bin/sh
# Copies a run's results into bench/results/<name>/: manifest, and per trial trial.json, the transcript,
# the built app (app.tar.gz, without node_modules) and the scorer's screenshots.
# Refuses when the token is unavailable or appears in any file, including the apps' git history.
# Usage: bench/publish.sh <run-dir> <name>
set -eu
run=$(realpath "$1"); results=$(dirname "$(realpath "$0")")/results; out=$results/$2
token=${CLAUDE_CODE_OAUTH_TOKEN:-$(cat "$HOME/.config/benchkeeper/oauth-token" 2>/dev/null || true)}
[ -n "$token" ] || { echo "no token to scan for: set CLAUDE_CODE_OAUTH_TOKEN or write ~/.config/benchkeeper/oauth-token" >&2; exit 1; }
tmp=$(mktemp -d "$results/.publish-XXXXXX") && trap 'rm -rf "$tmp"' EXIT
cp "$run/manifest.txt" "$tmp/"
for t in "$run"/round-*/*/; do
  [ -f "$t/trial.json" ] || continue
  if git -C "$t/workspace" log -p --all 2>/dev/null | grep -qF -- "$token"; then echo "token in git history of $t" >&2; exit 1; fi
  d=$tmp/$(basename "$(dirname "$t")")/$(basename "$t") && mkdir -p "$d"
  cp "$t/trial.json" "$d/" && gzip -9 -c "$t/transcript.jsonl" > "$d/transcript.jsonl.gz"
  [ ! -f "$t/score/app.tar.gz" ] || cp "$t/score/app.tar.gz" "$d/"
  [ ! -d "$t/score/screenshots" ] || cp -r "$t/score/screenshots" "$d/"
done
for f in $(find "$tmp" -type f); do
  case $f in *.gz) zcat "$f" | grep -qF -- "$token" ;; *) grep -qF -- "$token" "$f" ;; esac && { echo "token found in ${f#$tmp/}" >&2; exit 1; }
done
rm -rf "$out" && mv "$tmp" "$out" && trap - EXIT
du -sh "$out"
