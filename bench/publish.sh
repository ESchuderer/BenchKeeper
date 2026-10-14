#!/bin/sh
# Copies a run's results into bench/results/<name>/: manifest, and per trial trial.json, the transcript,
# the built app (app.tar.gz, without node_modules) and the scorer's screenshots. Refuses if the token appears anywhere.
# Usage: bench/publish.sh <run-dir> <name>
set -eu
run=$(realpath "$1"); out=$(dirname "$(realpath "$0")")/results/$2
mkdir -p "$out" && cp "$run/manifest.txt" "$out/"
for t in "$run"/round-*/*/; do
  [ -f "$t/trial.json" ] || continue
  d=$out/$(basename "$(dirname "$t")")/$(basename "$t") && mkdir -p "$d"
  cp "$t/trial.json" "$d/" && gzip -9 -c "$t/transcript.jsonl" > "$d/transcript.jsonl.gz"
  [ -f "$t/score/app.tar.gz" ] && cp "$t/score/app.tar.gz" "$d/"
  [ -d "$t/score/screenshots" ] && cp -r "$t/score/screenshots" "$d/"
done
token=${CLAUDE_CODE_OAUTH_TOKEN:-$(cat "$HOME/.config/benchkeeper/oauth-token" 2>/dev/null)}
if [ -n "$token" ]; then
  for f in $(find "$out" -type f); do
    case $f in *.gz) zcat "$f" | grep -qF -- "$token" ;; *) grep -qF -- "$token" "$f" ;; esac && { echo "token found in $f: removed $out" >&2; rm -rf "$out"; exit 1; }
  done
fi
du -sh "$out"
