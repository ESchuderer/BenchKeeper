#!/bin/sh
# Validates the hidden tests: the reference passes all features, and each mutant fails exactly its feature.
# The reference's data.js is built from the records in brief.md, so the app and the brief cannot drift apart.
# Usage: bench/briefs/cartridges/validate.sh <scratch-dir>
set -eu
here=$(dirname "$(realpath "$0")"); tmp=$(realpath -m "$1"); mkdir -p "$tmp"
# A feature passes only when its test ran and passed; skipped counts as failed.
result() { jq -r '[.. | objects | select(has("specs")) | .specs[] | select([.tests[].results[-1].status] | all(. == "passed") | not) | .title | split(" ")[0]] | join(",")' "$1/acceptance.json"; }
run() { # <name> <expected failing features> <file> <sed script or empty>
  rm -rf "$tmp/$1" "$tmp/$1-out"; cp -r "$here/reference" "$tmp/$1"
  sed -n '/^```jsonl$/,/^```$/p' "$here/brief.md" | sed '1d;$d' | jq -s -c . | sed 's/^/window.CARTRIDGES = /; s/$/;/' > "$tmp/$1/data.js"
  [ -z "$4" ] || sed -i "$4" "$tmp/$1/$3"
  [ -z "$4" ] || ! cmp -s "$here/reference/$3" "$tmp/$1/$3" || { echo "$1: mutation not applied"; exit 1; }
  "$here/../../scorer/score.sh" "$here" "$tmp/$1" "$tmp/$1-out" > /dev/null 2>&1 || true
  got=$(result "$tmp/$1-out"); [ "$got" = "$2" ] && echo "$1: ok (failing: ${got:-none})" || { echo "$1: expected '$2', got '$got'"; exit 1; }
}
run reference "" app.js ""
run aliases-ignored C2 app.js 's/\[c.name, ...(c.alternativeNames || \[\])\]/[c.name]/'
run no-l6 C4 app.js 's/hdim(0, L.L6, top - maxR - 8, `L6 ${L.L6}`),//'
run no-print-css C5 index.html '/print.css/d'
run modules C6 index.html 's/<script src=/<script type="module" src=/'
run no-address C6 app.js 's/^  route();$/  renderList();/'
# A correct app with other markup: the list as a table, the drawing named by <title>, the symbol as a plain cell, the
# Family select inside its label.
run variant "" app.js 's#el(.ul., { class: .list. })#el("table", {})#
s#el(.li., {}, el(.a., { href: `\#${c.key}`, text: c.name }),#el("tr", {}, el("td", {}, el("a", { href: `\#${c.key}`, text: c.name })),#
s#el(.span., { class: .muted., text: ` ${c.family}, L3 ${c.cartridge.lengths.L3} mm` })#el("td", { text: `${c.family}, L3 ${c.cartridge.lengths.L3} mm` })#
s#role="img" aria-label="${esc(c.name)} drawing" #aria-labelledby="t-${c.key}" #
s#xmlns="http://www.w3.org/2000/svg">`#xmlns="http://www.w3.org/2000/svg"><title id="t-${c.key}">${esc(c.name)} drawing</title>`#
s#el(.th., { scope: .row., text: LABELS\[f\] ?? f })#el("td", { text: LABELS[f] ?? f })#
s#el(.label., { for: .f., text: .Family . }), family#el("label", {}, "Family ", family)#'
