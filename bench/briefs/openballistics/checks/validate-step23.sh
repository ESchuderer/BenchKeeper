#!/bin/sh
# Validates the step 2 and step 3 checks: the reference overlays (on the baseline and reference/step1) pass every check,
# the step 2 reference fails both step 3 points, and each mutant fails exactly its check.
# Usage: bench/briefs/openballistics/checks/validate-step23.sh <scratch-dir>
set -eu
here=$(dirname "$(realpath "$0")"); brief=$(dirname "$here"); tmp=$(realpath -m "$1")
rm -rf "$tmp" && mkdir -p "$tmp"
commit() { git -C "$1" add -A && git -C "$1" -c user.name=ref -c user.email=ref@benchkeeper.invalid -c commit.gpgsign=false commit -qm "$2"; }
# The CHANGELOG overlays are part 1's reference/step1/CHANGELOG.md plus their own lines: stop if they drifted apart.
for k in 2 3; do grep -vxFf "$brief/reference/step$k/CHANGELOG.md" "$brief/reference/step1/CHANGELOG.md" && { echo "reference/step$k/CHANGELOG.md lacks the step 1 lines above"; exit 1; }; done
"$brief/prepare.sh" "$tmp/ws2" > /dev/null
for k in 1 2; do cp -r "$brief/reference/step$k/." "$tmp/ws2/"; commit "$tmp/ws2" "feat: reference step $k"; done
cp -a "$tmp/ws2" "$tmp/ws3" && cp -r "$brief/reference/step3/." "$tmp/ws3/" && commit "$tmp/ws3" "fix: reference step 3"

# run <step> <name> <expected failing ids> <shell command run in a copy, or empty> <step script>: the copy is made here,
# the check runs in the background, four at a time; report prints the results in order.
jobs=0
run() {
  ws=$tmp/ws$1; [ -z "$4" ] || { ws=$tmp/$2; rm -rf "$ws"; cp -a "$tmp/ws$1" "$ws"; (cd "$ws" && eval "$4"); }
  [ -z "$4" ] || [ -n "$(git -C "$ws" status --porcelain)" ] || { echo "$2: mutation not applied"; exit 1; }
  echo "$2 $3" >> "$tmp/runs"
  (start=$(date +%s); "$here/step$5.sh" "$ws" "$tmp/$2-out" > "$tmp/$2.log" 2>&1; echo $(($(date +%s) - start)) > "$tmp/$2.secs") &
  jobs=$((jobs + 1)); [ $((jobs % 4)) != 0 ] || wait
}
report() {
  wait; fail=0
  while read -r name want; do
    [ "$want" != - ] || want=
    got=$(jq -r '[.checks[] | select(.ok | not) | .id] | join(",")' "$tmp/$name-out/checks.json" 2>/dev/null || echo "no checks.json")
    if [ "$got" = "$want" ]; then echo "$name: ok (failing: ${got:-none}, $(cat "$tmp/$name.secs") s)"; else echo "$name: expected '$want', got '$got'"; fail=1; fi
  done < "$tmp/runs"
  exit $fail
}
C=site/src/routes/Compare.svelte
run 2 reference2 - "" 2
run 2 delta-sign S2-delta "sed -i 's/displayNumber(row.b - row.a, unit)/displayNumber(row.a - row.b, unit)/' $C" 2
run 2 own-scale S2-overlay "sed -i 's/fullSectionPath(profile, view)/fullSectionPath(profile, viewportFor([profile], { frame: \"landscape\", scale: 4 }))/' $C" 2
run 2 units-ignored S2-units "sed -i \"s/defaultUnit('length', unitSystem())/defaultUnit('length', unitSystem() \&\& 'metric')/\" $C" 2
run 2 reload S2-route "sed -i \"s/readable<Route>(parse(location.hash)/readable<Route>(location.hash.startsWith('#\/compare') ? { view: 'list' } : parse(location.hash)/\" site/src/lib/router.ts" 2
run 2 no-link S2-link "sed -i '/{t(.compare.go.)}/d' site/src/routes/Cartridge.svelte" 2
# A copy of lib/shapes2d/case.ts in the site, used instead of the library.
run 2 copied-profile S2-reuse "sed 's#../geom/profile#@lib/geom/profile#' lib/shapes2d/case.ts > site/src/lib/outline.ts && sed -i \"s#from '@lib/shapes2d'#from '../lib/outline'#\" $C" 2
# A correct view with other markup: upright half profiles as open paths at another scale, the drawing named by
# <title>, the symbol as a plain cell.
VARIANT='s/frame: .landscape., scale: 4/frame: "upright", scale: 2/
s/fullSectionPath(profile, view)/pathOf(profile, view, false)/
s/import { fullSectionPath, viewportFor }/import { pathOf, viewportFor }/
s/role="img" aria-label={[^}]*})}/role="img" aria-labelledby="cmp-title"/
s#xmlns="http://www.w3.org/2000/svg">#&<title id="cmp-title">{t(\x27compare.drawing\x27, { a: ra.name, b: rb.name })}</title>#
s/<th scope="row">{row.symbol}<\/th>/<td>{row.symbol}<\/td>/'
run 2 variant - 'sed -i "$VARIANT" '"$C" 2
run 3 reference3 - "" 3
run 2 step2-under-step3 "S3-bug,S3-style" "" 3
# The step 2 table with the step 3 alignment.
run 3 bug-left S3-bug "cp '$brief/reference/step2/site/src/lib/compare.ts' site/src/lib/ && cp '$brief/reference/step2/$C' $C && sed -i 's/^\\( *\\)\\(.compare th, .compare td { text-align: left.*\\)$/\\1\\2\\n\\1.compare :is(th, td):not(:first-child) { text-align: right; }/' $C" 3
run 3 style-left S3-style "sed -i '/:not(:first-child) { text-align: right; }/d' $C" 3
run 3 regression S3-regressions "sed -i 's/displayNumber(row.b - row.a, unit)/displayNumber(row.a - row.b, unit)/' $C" 3
report
