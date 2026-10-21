#!/bin/sh
# Rescores saved trials of a run with the current hidden tests (agent runs unchanged) and re-parses them.
# Usage: bench/rescore.sh <run-dir> <brief> [arms]   (skips trials without agent.exit or that are still running)
# A trial whose scoring fails keeps its results; the others are still rescored, and the script exits 1 at the end.
# MUTATION_ONLY=1 adds only the mutation score to the existing score directory (bench/scorer/mutation.sh).
set -eu
run=$(realpath "$1"); brief=$2; bench=$(dirname "$(realpath "$0")"); repo=$(dirname "$bench")
failed=
NODE=docker.io/library/node:22.23.3-bookworm-slim@sha256:efd0ab5780c2d9ab1f0f869571a00d5edb17793bff4cce4a2792e3eb0ffc7562
for t in "$run"/round-*/*/; do
  arm=$(basename "$t"); [ -n "${3:-}" ] && case " $3 " in *" $arm "*) ;; *) continue ;; esac
  [ -f "$t/agent.exit" ] && [ -f "$t/trial.json" ] || continue
  if [ "${MUTATION_ONLY:-}" = 1 ]; then "$bench/scorer/mutation.sh" "$t/workspace" "$t/score"
  else
    stage=$(mktemp -d "$t/.rescore-XXXXXX")
    trap 'rm -rf "$stage"' EXIT
    # score.sh reads the trial's snapshots next to its output: base.tar.gz (step 1's previous state) and steps/*/repo.tar.gz.
    [ ! -f "$t/base.tar.gz" ] || ln -s "$t/base.tar.gz" "$stage/base.tar.gz"
    for snapshot in "$t"/steps/*/repo.tar.gz; do
      [ -f "$snapshot" ] || continue
      step=$(basename "$(dirname "$snapshot")")
      mkdir -p "$stage/steps/$step"
      ln -s "$snapshot" "$stage/steps/$step/repo.tar.gz"
    done
    rm -f "$t/log/rescore.log"
    if ! "$bench/scorer/score.sh" "$bench/briefs/$brief" "$t/workspace" "$stage/score" > "$t/log/rescore.log" 2>&1; then
      echo "scoring failed for $t, previous results kept (log/rescore.log)" >&2
      rm -rf "$stage"; trap - EXIT; failed="$failed ${t#"$run"/}"; continue
    fi
    for snapshot in "$stage"/steps/*/repo.tar.gz; do
      [ -L "$snapshot" ] || continue
      step=$(basename "$(dirname "$snapshot")")
      rm "$snapshot"
      # Results score.sh writes only on some paths, so an earlier scoring's copy cannot remain.
      (cd "$t/steps/$step" && rm -rf checks.json checks.exit suite.json playwright.json diff.json scb.json eval)
      # The scorer container could write to the stage: replace links instead of writing through them.
      cp -a --remove-destination "$stage/steps/$step/." "$t/steps/$step/"
    done
    rm -rf "$t/score" && mv "$stage/score" "$t/score"
    # The current scorer image scored the trial (SCB step briefs).
    [ ! -f "$t/scb-image" ] || podman image inspect "${SCB_IMAGE:-benchkeeper-scb}" --format '{{.Id}}' > "$t/scb-image"
    rm -rf "$stage"; trap - EXIT
  fi
  podman run --rm --userns=keep-id -e HOME=/tmp -v "$repo":/repo:ro,Z -v "$t":/t:Z -w /repo "$NODE" node bench/scripts/trial.mjs /t "$arm"
  echo "$arm $(jq -c '{f: .score.features_passed, hidden: .score.hidden_tests, mutation: .score.mutation.score}' "$t/trial.json")"
done
[ -z "$failed" ] || { echo "rescoring failed for:$failed" >&2; exit 1; }
