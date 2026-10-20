#!/bin/sh
# Step <k> checks of a SlopCodeBench step brief on a copy of <workspace>; writes <out-dir>/checks.json and scb.json.
# Sourced by the brief's checks/step<k>.sh with K and PROBLEM set. In the scorer image (Containerfile): the harness's
# eval-snapshot for checkpoint k (its tests of checkpoints 1..k, local environment: uv init, uv add -r requirements.txt,
# uv run <entry>.py) and scb-check (verbosity, erosion). Checks: C<k>-core, C<k>-functionality, C<k>-error (the checkpoint's
# own tests of that group all pass; ok null when it has none) and from step 2 on C<k>-regression (every earlier test passes).
# Exit 0 for completed evaluations, including failed solutions. Infrastructure failures exit nonzero.
set -u
ws=$(realpath "$1"); out=$(realpath -m "$2"); mkdir -p "$out"
scb=$(realpath "$(dirname "$(realpath "$0")")/../../scb")
. "$scb/config.sh"
problems=$scb/.cache/problems-$PROBLEMS
SCB_IMAGE=$(podman image inspect "${SCB_IMAGE:-benchkeeper-scb}" --format '{{.Id}}') || exit 1
copy=$(mktemp -d); trap 'rm -rf "$copy"' EXIT
trap 'exit 130' INT TERM HUP
tar -C "$ws" --exclude=.venv --exclude=.git -cf - . | tar -C "$copy" -xf -
podman run --rm --timeout 900 -e SCBENCH_PROBLEMS_PATH=/problems -e K="$K" -e PROBLEM="$PROBLEM" \
  -v "$copy":/snap:ro,Z -v "$problems":/problems:ro,z -v "$out":/out:Z "${SCB_IMAGE:-benchkeeper-scb}" sh -c '
  cp -r /snap /tmp/w && cd /tmp && rm -rf /out/eval
  slop-code -q eval-snapshot /tmp/w -o /out/eval -p "$PROBLEM" -c "$K" -e /opt/scb/configs/environments/local-py.yaml --json > /tmp/eval.json 2> /out/eval.err
  erc=$?
  scb-check check --report --include-all /snap > /tmp/quality.json 2> /out/quality.err
  qrc=$?
  jq -e "type == \"object\"" /tmp/eval.json > /dev/null 2>&1 || echo null > /tmp/eval.json
  jq -e "type == \"object\"" /tmp/quality.json > /dev/null 2>&1 || echo null > /tmp/quality.json
  jq -n --argjson erc "$erc" --argjson qrc "$qrc" --slurpfile e /tmp/eval.json --slurpfile q /tmp/quality.json "{evaluation_exit: \$erc, quality_exit: \$qrc, eval: (\$e[0] // null | if . then {pass_counts, total_counts, pytest_exit_code, infrastructure_failure, test_collection_hash} else null end), quality: (if \$qrc == 0 then \$q[0] else null end)}"
' > "$out/scb.json" 2> "$out/checks.err"
rc=$?
if [ "$rc" -ne 0 ] || ! jq -e 'type == "object"' "$out/scb.json" > /dev/null 2>&1; then
  printf '{"evaluation_exit":%s,"eval":null,"quality":null}\n' "$rc" > "$out/scb.json"
fi
jq --arg image "$SCB_IMAGE" '. + {scorer_image: $image}' "$out/scb.json" > "$out/scb.tmp" && mv "$out/scb.tmp" "$out/scb.json" || exit 1
jq --argjson k "$K" -f "$scb/checks/report.jq" "$out/scb.json" > "$out/checks.json" || exit 1
jq -e '.infrastructure_error == null' "$out/checks.json" > /dev/null
