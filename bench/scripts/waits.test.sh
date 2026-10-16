#!/bin/sh
# Checks the follow-up rule's detection of final messages that wait for the user (`waiting` in bench/run-brief.sh).
# Usage: sh bench/scripts/waits.test.sh
set -eu
eval "$(sed -n '/^WAITS=/p; /^waiting() {/,/; }$/p' "$(dirname "$0")/../run-brief.sh")"
fail=0
check() { # <expected yes|no> <message>
  if printf '%b\n' "$2" | waiting; then got=yes; else got=no; fi
  [ "$got" = "$1" ] || { echo "expected $1, got $got: $2"; fail=1; }
}
check yes "Plan written.\n\nOnce you confirm, I'll continue with group 2 (store tests first, then implementation)."
check yes "Artifacts are in openspec/changes/x.\nShall I start implementing?"
check yes "The proposal is ready for your approval."
check no "4. Guest bookings are not rate limited. This needs your approval before I add a limit.\n6. Archive is not done; I left it for you to run."
check yes "Should I proceed with the build."
check yes "Want me to add CI?"
check no "Done. npm start serves the app on port 3000."
check no "Open questions?\n- none\n\nAll six features are implemented and tested."
check no "Let me know if you want a dark theme later."
[ "$fail" = 0 ] && echo "waits: all checks pass"
exit "$fail"
