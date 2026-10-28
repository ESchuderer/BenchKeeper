#!/bin/sh
# Usage: status.sh <worktree path> <todo|in-progress|in-review|completed>
# Sets the board status of a worker's worktree in the runner, where the runner has a board; without its CLI it sets nothing.
case "$2" in todo|in-progress|in-review|completed) ;; *) echo "status must be todo, in-progress, in-review or completed" >&2; exit 2 ;; esac
[ -d "$1" ] || { echo "no worktree $1" >&2; exit 2; }
command -v orca >/dev/null || { echo "no runner board: nothing set"; exit 0; }
orca worktree set --worktree "path:$1" --workspace-status "$2" --json >/dev/null
