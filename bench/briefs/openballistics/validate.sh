#!/bin/sh
# Validates the checks of every step: the reference passes every check, and each mutant fails exactly its check.
# Usage: bench/briefs/openballistics/validate.sh <scratch-dir>
set -eu
here=$(dirname "$(realpath "$0")"); tmp=$(realpath -m "$1"); mkdir -p "$tmp"
# The follow-up rule must not wait for an app (no start script in the repository): only a final message that waits fires it.
jq -e '.steps == "sessions" and .serve == "none"' "$here/brief.json" > /dev/null || { echo "brief.json: steps sessions and serve none expected" >&2; exit 1; }
"$here/checks/validate-step1.sh" "$tmp/step1"
"$here/checks/validate-step23.sh" "$tmp/step23"
