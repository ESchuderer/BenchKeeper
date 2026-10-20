#!/bin/sh
# The agent's own pytest tests (tests/ or test_*.py) on a copy of <workspace>, in the scorer image: uv init, uv add -r
# requirements.txt and pytest, 10 minutes at most; writes <out-dir>/suite.json {"ok": bool or null without tests, "exit": n}.
# Exit 0 when the suite ran, whatever its result.
# Usage: bench/briefs/scb/checks/suite.sh <workspace> <out-dir>
set -u
ws=$(realpath "$1"); out=$(realpath -m "$2"); mkdir -p "$out"
copy=$(mktemp -d); trap 'rm -rf "$copy"' EXIT
trap 'exit 130' INT TERM HUP
tar -C "$ws" --exclude=.venv --exclude=.git -cf - . | tar -C "$copy" -xf -
if ! find "$copy" -name 'test_*.py' -o -name '*_test.py' | grep -q .; then echo '{"ok":null,"exit":null}' > "$out/suite.json"; exit 0; fi
podman run --rm --timeout 600 -v "$copy":/w:Z -w /w benchkeeper-scb \
  sh -c 'uv init -q --bare 2> /dev/null; [ ! -s requirements.txt ] || uv add -q -r requirements.txt && uv run --with pytest pytest -q' 2>&1
rc=$?
printf '{"ok":%s,"exit":%d}\n' "$([ "$rc" = 0 ] && echo true || echo false)" "$rc" > "$out/suite.json"
