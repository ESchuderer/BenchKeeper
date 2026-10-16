#!/bin/sh
# Validates the checks: the baseline fails the task's checks, the reference passes every check and its suite, and each
# mutant of the reference fails exactly its check (mutants/<name>/ and variants/<name>/ are copied over it; a variant
# is another valid fix and passes every check). Usage: bench/briefs/skill-debug-discount/validate.sh <scratch-dir>
set -eu
here=$(dirname "$(realpath "$0")"); tmp=$(realpath -m "$1"); mkdir -p "$tmp"
. "$here/../skill-common/validate-lib.sh"
build_reference
case_ baseline S1-batch,S1-root,S1-test
case_ reference ""
case_ symptom-fix S1-root "R src/pricing.js 'return { ...product, qty };' 'return Object.assign(product, { qty });' '  for (const line of lines) if (!line.noDiscount) line.price = Math.round((line.price * (100 - pct)) / 100);
  return lines;' '  return lines.map((l) => (l.noDiscount ? l : { ...l, price: Math.round((l.price * (100 - pct)) / 100) }));'"
case_ rounding-down S1-discount "R src/pricing.js 'Math.round(' 'Math.floor('"
case_ no-regression-test S1-test "rm test/batch.test.js"
case_ helper-import S1-test "cp -a /brief/mutants/helper-import/. ."
# Another valid fix (variants/plain-catalog/: a frozen plain-object catalog, applyDiscount without side effects) passes.
case_ plain-catalog "" "cp -a /brief/variants/plain-catalog/. ."
case_ message-changed S1-regressions "R src/pricing.js 'unknown SKU' 'no such SKU'"
