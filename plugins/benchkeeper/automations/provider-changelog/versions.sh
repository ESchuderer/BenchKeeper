#!/bin/sh
# Prints one line "<agent> <version>" per installed agent CLI: the first x.y.z its --version prints, as the app reads it.
for a in claude codex gemini copilot; do
  v=$("$a" --version 2>/dev/null | grep -oE '[0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9}[A-Za-z0-9._-]*' | head -n 1)
  [ -n "$v" ] && echo "$a $v"
done
exit 0
