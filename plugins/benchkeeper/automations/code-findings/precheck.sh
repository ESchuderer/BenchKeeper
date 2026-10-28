#!/bin/sh
# Exit 0 to start the run: no session of this automation is alive and the adapter reports open findings (list.sh).
if pgrep -f "automation-[c]ode-findings" >/dev/null; then exit 1; fi
"$(dirname "$0")/list.sh" "$1" "$2" "$3" >/dev/null
