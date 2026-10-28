#!/bin/sh
# Exit 0 to start the run: no session of this automation is alive and a workflow is due (due.sh).
if pgrep -f "automation-[c]i-health" >/dev/null; then exit 1; fi
"$(dirname "$0")/due.sh" "$1" "$2" >/dev/null
