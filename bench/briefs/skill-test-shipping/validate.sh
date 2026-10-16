#!/bin/sh
# Validates the checks: the baseline fails the task's checks, the reference passes every check and its suite, and each
# mutant of the reference (a test assertion removed, a source change, failing tests) fails exactly its checks.
# Usage: bench/briefs/skill-test-shipping/validate.sh <scratch-dir>
set -eu
here=$(dirname "$(realpath "$0")"); tmp=$(realpath -m "$1"); mkdir -p "$tmp"
. "$here/../skill-common/validate-lib.sh"
build_reference
all=S1-kill-express-base-only,S1-kill-express-free,S1-kill-free-eu,S1-kill-started-step,S1-kill-threshold,S1-kill-zero-weight
case_ baseline "S1-green,$all"
case_ reference ""
t=test/shipping.test.js
case_ no-express-total S1-kill-express-base-only "R $t '  assert.equal(cost({ weight: 2000, zone: \"eu\", express: true }), 2 * (990 + 2 * 250));
' ''"
case_ no-express-free S1-kill-express-free "R $t '  assert.equal(cost({ weight: 1000, subtotal: 9000, express: true }), 980);
' ''"
case_ no-eu-free S1-kill-free-eu "R $t '  assert.equal(cost({ weight: 1000, subtotal: 9000, zone: \"eu\" }), 990);
' ''"
case_ no-started-step S1-kill-started-step "R $t '  assert.equal(cost({ weight: 1001 }), 590);
  assert.equal(cost({ weight: 1500, zone: \"eu\" }), 1240);
  assert.equal(cost({ weight: 2200, zone: \"world\" }), 1990 + 3 * 600);
' '  assert.equal(cost({ weight: 1500, zone: \"eu\" }), 1240);
'"
case_ no-threshold S1-kill-threshold "R $t '  assert.equal(cost({ weight: 3000, subtotal: 5000 }), 0);
' '  assert.equal(cost({ weight: 3000, subtotal: 5001 }), 0);
'"
case_ no-zero-weight S1-kill-zero-weight "R $t '  assert.throws(() => cost({ weight: 0 }), RangeError);
' ''"
case_ red-tests "S1-green,$all" "R $t 'assert.equal(cost({ weight: 1000 }), 490);' 'assert.equal(cost({ weight: 1000 }), 491);'"
case_ src-edited S1-src-unchanged "R src/shipping.js 'const STEP = 500;' 'const STEP = 500; // grams'"
