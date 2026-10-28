#!/bin/sh
# Exit 0 to start the run: no session of this automation is alive, and the temporary space is above the limit ($1) or
# a worktree or branch is removable (sweep.sh).
if pgrep -f "automation-[w]orktree-cleanup" >/dev/null; then exit 1; fi
"$(dirname "$0")/sweep.sh" report "$1" >/dev/null
