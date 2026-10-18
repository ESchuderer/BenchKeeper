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
check yes "- **Version bump:** 4.4.0?\n\nOnce the environment is set up and you answer the questions above, I'll start with the failing tests.\n\nNot checked yet: the other node types."
check yes "1. Is the feature on another branch?\n\nThere is no devcontainer. Please run \`/benchkeeper:setting-up-projects\` before I run \`npm test\`."
check yes "3. **This is the wrong repository.** Point me to the right one.\nWhich of these is true? See above."
check no "All checks pass. The answer to the open question in the issue is in the README."
check yes "4. The default branch is master. Should I commit on feat/x?\nI'll wait for your answers before making any edits."
check yes "- Node ids are not preserved.\nNot done yet: the implementation, the README section, and the commits. Nothing has been run."
check yes "- **What I need from you:** run \`/benchkeeper:setting-up-projects\`, or tell me that host installs are fine.\n\nI made two behaviour decisions.\n- a\n- b\n- c\n- d\n\nI haven't looked at dist/ yet."
check yes "Implemented and committed, not tested. Please run npm test, or run \`/benchkeeper:setting-up-projects\` and I'll re-run it.\n\n- a\n- b\n- c\n- d\n- e"
[ "$fail" = 0 ] && echo "waits: all checks pass"
exit "$fail"
