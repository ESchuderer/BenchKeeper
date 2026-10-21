#!/bin/sh
# Store one immutable input manifest from stdin, or reject a resume with changed inputs.
set -eu
file=$1
mkdir -p "$(dirname "$file")"
tmp=$(mktemp "$file.XXXXXX")
trap 'rm -f "$tmp"' EXIT
cat > "$tmp"
# A hard link publishes the complete file atomically, also with parallel runners.
ln "$tmp" "$file" 2>/dev/null || cmp -s "$tmp" "$file" || {
  echo "run inputs changed: $file (start a new run with a new seed)" >&2
  exit 1
}
