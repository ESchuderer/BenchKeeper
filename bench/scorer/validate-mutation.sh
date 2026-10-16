#!/bin/sh
# Validates the mutation step on fixtures: tests that assert behavior score higher than tests that only run the code,
# an app without tests gets no score (exit 11), and an app on TypeScript 7 is scored like the same app without it.
# Usage: bench/scorer/validate-mutation.sh <scratch-dir>
set -eu
here=$(dirname "$(realpath "$0")"); tmp=$(realpath -m "$1"); mkdir -p "$tmp"
score() { node -e '
  const r = require(process.argv[1]); const n = { Killed: 0, Timeout: 0, Survived: 0, NoCoverage: 0 };
  for (const f of Object.values(r.files)) for (const m of f.mutants) if (m.status in n) n[m.status]++;
  console.log(Math.round(1000 * (n.Killed + n.Timeout) / (n.Killed + n.Timeout + n.Survived + n.NoCoverage)) / 10);' "$1"; }
for f in strong weak none ts7; do "$here/mutation.sh" "$here/fixtures/mutation/$f" "$tmp/$f"; done
[ "$(cat "$tmp/none/mutation.exit")" = 11 ] || { echo "none: expected exit 11, got $(cat "$tmp/none/mutation.exit")"; exit 1; }
for f in strong weak ts7; do [ "$(cat "$tmp/$f/mutation.exit")" = 0 ] || { echo "$f: exit $(cat "$tmp/$f/mutation.exit")"; tail -5 "$tmp/$f/mutation.log"; exit 1; }; done
s=$(score "$tmp/strong/mutation.json"); w=$(score "$tmp/weak/mutation.json")
t=$(score "$tmp/ts7/mutation.json")
echo "strong $s, weak $w, ts7 $t, none: no score"
[ "$t" = "$s" ] || { echo "expected ts7 to score like strong ($s), got $t"; exit 1; }
node -e 'process.exit(Number(process.argv[1]) > Number(process.argv[2]) + 30 ? 0 : 1)' "$s" "$w" || { echo "expected strong at least 30 points above weak"; exit 1; }
