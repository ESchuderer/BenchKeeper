#!/bin/sh
# Exit 0 to start the run: no session of this automation is alive and a dependency pull request or an alert is open (list.sh).
if pgrep -f "automation-[d]ependency-triage" >/dev/null; then exit 1; fi
"$(dirname "$0")/list.sh" "$1" "$2" >/dev/null
