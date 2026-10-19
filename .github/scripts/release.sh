#!/bin/sh
# BenchKeeper plugin releases. The version lives in both plugin manifests; x.y.0 is released as tag setup-vx.y.
#   check <base>: a change under plugins/benchkeeper/ since <base> raises the version and adds its CHANGELOG entry.
#   tag: prints the tag of the current version. notes: prints its CHANGELOG section.
set -eu
p=plugins/benchkeeper
fail() { echo "::error::$1" >&2; exit 1; }
ver() { jq -r .version "$p/.claude-plugin/plugin.json"; }
tag() { v=$(ver); echo "setup-v${v%.*}"; }

case ${1:-} in
check)
  base=${2:?base ref}
  if git diff --quiet "$base"...HEAD -- "$p"; then echo "no change under $p"; exit 0; fi
  new=$(ver)
  [ "$new" = "$(jq -r .version "$p/.codex-plugin/plugin.json")" ] || fail "version differs between .claude-plugin and .codex-plugin"
  echo "$new" | grep -Eq '^[0-9]+\.[0-9]+\.0$' || fail "version $new: use major.minor.0"
  old=$(git show "$base:$p/.claude-plugin/plugin.json" | jq -r .version)
  [ "$new" != "$old" ] && [ "$(printf '%s\n%s\n' "$old" "$new" | sort -V | tail -1)" = "$new" ] \
    || fail "$p changed: raise the version in both plugin.json files above $old"
  grep -q "^## $(tag) (" CHANGELOG.md || fail "CHANGELOG.md needs an entry '## $(tag) (<date>)'"
  echo "release $(tag) ok"
  ;;
tag) tag ;;
notes) awk -v h="## $(tag) (" 'index($0, h) == 1 { on = 1; next } on && /^## / { exit } on' CHANGELOG.md ;;
*) fail "usage: release.sh check <base> | tag | notes" ;;
esac
