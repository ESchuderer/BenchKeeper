#!/bin/sh
# Self-check for release.sh in a throwaway repository.
set -eu
script=$(cd "$(dirname "$0")" && pwd)/release.sh
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cd "$tmp"
git init -q -b main
g() { git -c user.name=t -c user.email=t@t "$@"; }
setv() { for d in .claude-plugin .codex-plugin; do mkdir -p plugins/benchkeeper/$d; echo "{\"version\":\"$1\"}" > plugins/benchkeeper/$d/plugin.json; done; }
expect() { if sh "$script" check main >/dev/null 2>&1; then got=0; else got=1; fi
  [ "$got" = "$1" ] && echo "ok: $2" || { echo "FAIL: $2"; exit 1; }; }
setv 5.1.0; printf '# Changelog\n\n## setup-v5.1 (2026-10-19)\n\n- old\n' > CHANGELOG.md
g add -A; g commit -qm init; git switch -qc pr
echo x > README.md; g add -A; g commit -qm docs
expect 0 "no plugin change passes"
echo x > plugins/benchkeeper/skill.md; g add -A; g commit -qm skill
expect 1 "plugin change without a version bump fails"
setv 5.2.0; g add -A; g commit -qm bump
expect 1 "bump without a CHANGELOG entry fails"
printf '# Changelog\n\n## setup-v5.2 (2026-10-20)\n\n- new\n\n## setup-v5.1 (2026-10-19)\n\n- old\n' > CHANGELOG.md; g add -A; g commit -qm log
expect 0 "bump with a CHANGELOG entry passes"
echo '{"version":"5.3.0"}' > plugins/benchkeeper/.codex-plugin/plugin.json
expect 1 "differing manifest versions fail"
git checkout -q plugins
[ "$(sh "$script" tag)" = setup-v5.2 ] && echo "ok: tag" || { echo "FAIL: tag"; exit 1; }
[ "$(sh "$script" notes | grep -c .)" = 1 ] && sh "$script" notes | grep -qx -- '- new' && echo "ok: notes" || { echo "FAIL: notes"; exit 1; }
