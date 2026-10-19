#!/bin/sh
# Validates the checks: the untouched baseline fails every hidden check of step 1, and a reference trial (reference/
# applied in step 1, then a README note, a test and a version row per step) passes every check of every step.
# Usage: bench/briefs/mistreevous/validate.sh <scratch-dir>
set -eu
here=$(dirname "$(realpath "$0")"); tmp=$(realpath -m "$1"); rm -rf "$tmp" && mkdir -p "$tmp"
jq -e '.steps == "sessions" and .serve == "none"' "$here/brief.json" > /dev/null || { echo "brief.json: steps sessions and serve none expected" >&2; exit 1; }
NODE=docker.io/library/node:22.23.3-bookworm@sha256:0e5f906573693feaa1e21057ebdcfdb5bd5021f050b2dc7c9deceb629c7da2a8
"$here/prepare.sh" "$tmp/repo"
tar -czf "$tmp/base.tar.gz" -C "$tmp/repo" .
# Reference trial: commits in a container, the snapshots as run-brief.sh saves them.
mkdir -p "$tmp/snaps"
podman run --rm --userns=keep-id -e HOME=/tmp -v "$tmp/repo":/w:Z -v "$tmp/snaps":/out:Z -v "$here/reference":/ref:ro,z -w /w "$NODE" sh -euc '
  export GIT_AUTHOR_NAME=ref GIT_AUTHOR_EMAIL=ref@benchkeeper.invalid GIT_COMMITTER_NAME=ref GIT_COMMITTER_EMAIL=ref@benchkeeper.invalid
  bump() { # <version> <note>
    node -e "const f=\"package.json\",p=JSON.parse(require(\"fs\").readFileSync(f));p.version=process.argv[1];require(\"fs\").writeFileSync(f,JSON.stringify(p,null,4)+\"\n\")" "$1"
    sed -i "0,/^| -------------- |/s//&\n| $1          | $2 |/" README.md; }
  cp -r /ref/src/. src/ && cp /ref/test/BehaviourTreeSnapshot.spec.ts test/
  printf "\n## Snapshot and Restore\n\`tree.snapshot()\` returns the execution state as a plain object, \`tree.restore(snapshot)\` sets a tree of the same definition to it.\n" >> README.md
  bump 4.4.0 "Added snapshot and restore of the execution state"
  git add -A && git commit -qm "feat: snapshot and restore" && tar -czf /out/1.tar.gz .
  printf "An action whose promise is pending at snapshot time is restored as not started.\n" >> README.md
  sed -i "s/it(\"rejects a snapshot/it(\"rejects a snapshot (step 2)/" test/BehaviourTreeSnapshot.spec.ts
  printf "\ndescribe(\"Snapshot input\", () => {\n    it(\"is validated\", () => {});\n});\n" >> test/BehaviourTreeSnapshot.spec.ts
  bump 4.4.1 "Snapshots are checked against the tree definition"
  git add -A && git commit -qm "feat: check snapshots against the definition" && tar -czf /out/2.tar.gz .
  printf "\ndescribe(\"Snapshot regressions\", () => {\n    it(\"restore reports no state changes\", () => {});\n});\n" >> test/BehaviourTreeSnapshot.spec.ts
  bump 4.4.2 "Restore no longer reports state changes"
  git add -A && git commit -qm "fix: restore without state change events" && tar -czf /out/3.tar.gz .'
t=$tmp/trial; mkdir -p "$t/steps/1" "$t/steps/2" "$t/steps/3"; cp "$tmp/base.tar.gz" "$t/"
for k in 1 2 3; do mv "$tmp/snaps/$k.tar.gz" "$t/steps/$k/repo.tar.gz"; done
fail=0
for k in 1 2 3; do
  ws=$(mktemp -d) && tar -xzf "$t/steps/$k/repo.tar.gz" -C "$ws"
  "$here/checks/step$k.sh" "$ws" "$t/steps/$k"; "$here/checks/suite.sh" "$ws" "$t/steps/$k" > "$t/steps/$k/suite.log"
  rm -rf "$ws"
  jq -e '.ok' "$t/steps/$k/suite.json" > /dev/null || { echo "reference step $k: suite fails" >&2; fail=1; }
  bad=$(jq -r '[.checks[] | select(.ok != true) | .id + ": " + (.detail // "")] | join("; ")' "$t/steps/$k/checks.json")
  n=$(jq '.checks | length' "$t/steps/$k/checks.json")
  [ -z "$bad" ] && [ "$n" -gt 0 ] || { echo "reference step $k fails: ${bad:-no checks}" >&2; fail=1; }
  echo "reference step $k: $n checks pass"
done
# The baseline as step 1: no hidden check of step 1 may pass.
b=$tmp/baseline; mkdir -p "$b/steps/1"; cp "$tmp/base.tar.gz" "$b/"
ws=$(mktemp -d) && tar -xzf "$tmp/base.tar.gz" -C "$ws" && "$here/checks/step1.sh" "$ws" "$b/steps/1"; rm -rf "$ws"
passing=$(jq -r '[.checks[] | select((.id | startswith("S1-")) and .ok == true) | .id] | join(", ")' "$b/steps/1/checks.json")
[ -z "$passing" ] || { echo "baseline passes: $passing" >&2; fail=1; }
echo "baseline: $(jq '[.checks[] | select(.id | startswith("S1-"))] | length' "$b/steps/1/checks.json") step 1 hidden checks fail"
exit "$fail"
