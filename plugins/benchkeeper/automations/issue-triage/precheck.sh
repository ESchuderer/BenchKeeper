#!/bin/sh
# Exit 0 to start the run: no session of this automation is alive and an open issue has none of the triage labels (list.sh).
if pgrep -f "automation-[i]ssue-triage" >/dev/null; then exit 1; fi
"$(dirname "$0")/list.sh" "$1" "$2" "$3" >/dev/null
