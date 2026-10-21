#!/bin/sh
# Run after prepare.sh for both briefs. References pass every populated group, empty code fails each populated group.
set -eu
here=$(dirname "$(realpath "$0")")
. "$here/config.sh"
cache=$here/.cache/problems-$PROBLEMS
SCB_IMAGE=$(podman image inspect "${SCB_IMAGE:-benchkeeper-scb}" --format '{{.Id}}')
export SCB_IMAGE
podman run --rm --network none "$SCB_IMAGE" sh -c 'python3 -c "import mimetypes; assert mimetypes.guess_type(\"preview.webp\")[0] == \"image/webp\"" && sg --version | grep -q ast-grep'
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
trap 'exit 130' INT TERM HUP
for problem in xjq mvvault; do
  p=$cache/$problem
  [ -d "$p/solutions" ] || { echo "prepare scb-$problem first" >&2; exit 1; }
  for reference in "$p"/solutions/checkpoint_*; do
    k=${reference##*_}
    for kind in reference empty; do
      ws=$tmp/$problem/$k/$kind/workspace
      out=$tmp/$problem/$k/$kind/report
      mkdir -p "$ws"
      if [ "$kind" = reference ]; then cp -a "$reference/." "$ws/"; else touch "$ws/requirements.txt"; fi
      "$here/../scb-$problem/checks/step$k.sh" "$ws" "$out"
      jq -e --arg kind "$kind" '
        .infrastructure_error == null and
        ([.checks[] | select(.ok != null)] | length > 0 and all(.[]; .ok == ($kind == "reference")))
      ' "$out/checks.json" > /dev/null || { echo "FAIL $problem checkpoint $k $kind" >&2; exit 1; }
      if [ "$kind" = reference ]; then
        jq -e '.quality_exit == 0 and (.quality | type) == "object"' "$out/scb.json" > /dev/null
      else
        jq -e '.quality_exit == 2 and .quality == null' "$out/scb.json" > /dev/null
        grep -qx 'no Python files found at /snap' "$out/quality.err"
      fi
      echo "PASS $problem checkpoint $k $kind"
    done
  done
done
