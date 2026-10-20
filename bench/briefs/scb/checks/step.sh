#!/bin/sh
# Step <k> checks of a SlopCodeBench step brief on a copy of <workspace>; writes <out-dir>/checks.json and scb.json.
# Sourced by the brief's checks/step<k>.sh with K and PROBLEM set. In the scorer image (Containerfile): the harness's
# eval-snapshot for checkpoint k (its tests of checkpoints 1..k, local environment: uv init, uv add -r requirements.txt,
# uv run <entry>.py) and scb-check (verbosity, erosion). Checks: C<k>-core, C<k>-functionality, C<k>-error (the checkpoint's
# own tests of that group all pass; ok null when it has none) and from step 2 on C<k>-regression (every earlier test passes).
# Exit 0 when the checks ran, whatever their result.
set -u
ws=$(realpath "$1"); out=$(realpath -m "$2"); mkdir -p "$out"
scb=$(realpath "$(dirname "$(realpath "$0")")/../../scb")
problems=$(ls -d "$scb"/.cache/problems-* | head -1)
copy=$(mktemp -d); trap 'rm -rf "$copy"' EXIT
trap 'exit 130' INT TERM HUP
tar -C "$ws" --exclude=.venv --exclude=.git -cf - . | tar -C "$copy" -xf -
podman run --rm --timeout 900 -e SCBENCH_PROBLEMS_PATH=/problems -e K="$K" -e PROBLEM="$PROBLEM" \
  -v "$copy":/snap:ro,Z -v "$problems":/problems:ro,z -v "$out":/out:Z benchkeeper-scb sh -c '
  cp -r /snap /tmp/w && cd /tmp && rm -rf /out/eval
  slop-code -q eval-snapshot /tmp/w -o /out/eval -p "$PROBLEM" -c "$K" -e /opt/scb/configs/environments/local-py.yaml --json > /tmp/eval.json 2> /out/eval.err
  scb-check check --report --include-all /snap > /tmp/quality.json 2> /out/quality.err || echo "{}" > /tmp/quality.json
  jq -n --slurpfile e /tmp/eval.json --slurpfile q /tmp/quality.json "{eval: (\$e[0] // null | if . then {pass_counts, total_counts, pytest_exit_code, infrastructure_failure} else null end), quality: (\$q[0] // {})}"
' > "$out/scb.json" 2> "$out/checks.err"
jq -e . "$out/scb.json" > /dev/null 2>&1 || echo '{"eval":null,"quality":{}}' > "$out/scb.json"
jq --argjson k "$K" '.eval as $e | {checks: ([["Core","core"],["Functionality","functionality"],["Error","error"]] + (if $k > 1 then [["Regression","regression"]] else [] end)
  | map(.[0] as $g | {id: "C\($k)-\(.[1])", ok: (if $e == null then false elif ($e.total_counts[$g] // 0) == 0 then null else $e.pass_counts[$g] == $e.total_counts[$g] end)}))}' \
  "$out/scb.json" > "$out/checks.json"
exit 0
