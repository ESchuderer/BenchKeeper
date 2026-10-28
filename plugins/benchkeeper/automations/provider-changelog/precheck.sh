#!/bin/sh
# Usage: precheck.sh <report file> <sources, comma separated>
# Exit 2 for a source that is not an official provider page. Exit 0 to start the run: no session of this automation is
# alive, an agent CLI is installed, and there is no report yet or it lacks a line "<agent> <version>" of versions.sh.
[ -n "$2" ] || { echo "sources is empty" >&2; exit 2; }
for s in $(echo "$2" | tr , ' '); do
  case "$s" in
    *..*) ;;
    github.com/anthropics/claude-code/*|code.claude.com/docs/*|docs.claude.com/*|docs.anthropic.com/*) continue ;;
    github.com/openai/codex/*|developers.openai.com/codex/*) continue ;;
    github.com/google-gemini/gemini-cli/*) continue ;;
    github.com/github/copilot-cli/*|docs.github.com/*/copilot/*|github.blog/changelog/*) continue ;;
  esac
  echo "not an official provider page: $s" >&2
  exit 2
done
if pgrep -f "automation-[p]rovider-changelog" >/dev/null; then exit 1; fi
v=$("$(dirname "$0")/versions.sh")
[ -n "$v" ] || exit 1
[ -f "$1" ] || exit 0
! printf '%s\n' "$v" | while read -r line; do grep -Fxq -- "$line" "$1" || exit 1; done
