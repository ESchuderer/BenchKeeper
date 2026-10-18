#!/bin/sh
# Self-check for setup.sh against a temporary HOME, with stub claude, codex, npm and devcontainer commands. No network.
set -eu
setup=$(cd "$(dirname "$0")" && pwd)/setup.sh
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
export HOME="$t/home" PATH="$t/bin:$PATH"
mkdir -p "$HOME" "$t/bin"
stub() { printf '#!/bin/sh\n%s\n' "$2" >"$t/bin/$1"; chmod +x "$t/bin/$1"; }
# Plugins count as installed once the stub saw an install; npm knows one release older and one newer than 7 days.
stub claude 'case "$1 $2" in "plugin list") [ -f "$HOME/.c" ] && echo "[{\"id\":\"benchkeeper@benchkeeper\",\"enabled\":true},{\"id\":\"ponytail@ponytail\",\"enabled\":true},{\"id\":\"mattpocock-skills@claude-plugins-official\",\"enabled\":true}]" || echo "[]" ;; "plugin install") touch "$HOME/.c" ;; esac'
stub codex 'case "$1 $2" in "plugin list") [ -f "$HOME/.x" ] && echo "{\"installed\":[{\"pluginId\":\"benchkeeper@benchkeeper\",\"enabled\":true},{\"pluginId\":\"ponytail@ponytail\",\"enabled\":true},{\"pluginId\":\"mattpocock-skills@mattpocock\",\"enabled\":true}]}" || echo "{\"installed\":[]}" ;; "plugin add") [ ! -f "$HOME/.fail" ] && touch "$HOME/.x" ;; esac'
stub npm 'case "$1" in view) echo "[{\"created\":\"2020-01-01T00:00:00Z\",\"1.0.0\":\"2020-01-01T00:00:00Z\",\"9.9.9\":\"2999-01-01T00:00:00Z\"}]" ;; i) echo "1.0.0" >"$HOME/.dc" ;; esac'
stub devcontainer 'cat "$HOME/.dc" 2>/dev/null || true'
stub docker 'exit 0'
stub orca 'exit 0'
stub npx 'n=; p=; for a; do [ "$p" = -s ] && n=$a; case "$p $a" in "-a claude-code") mkdir -p "$HOME/.claude/skills/$n" ;; "-a codex") mkdir -p "$HOME/.agents/skills/$n" ;; esac; p=$a; done'

fail() { echo "FAIL: $1"; exit 1; }
pass() { echo "ok: $1"; }
snapshot() { (cd "$HOME" && find . -exec ls -ld {} + 2>/dev/null | awk '{print $1, $5, $NF}' | sort); }

mkdir -p "$HOME/.claude/rules" "$HOME/.claude/skills" "$HOME/.codex"
echo "old rules" >"$HOME/.claude/CLAUDE.md"
echo "other" >"$HOME/.claude/rules/10-other.md"
ln -s /nowhere/skills/following-dev-workflow "$HOME/.claude/skills/following-dev-workflow"
echo '{"hooks":{"Stop":[]},"model":"opus"}' >"$HOME/.claude/settings.json"
echo "my codex rules" >"$HOME/.codex/AGENTS.md"

before=$(snapshot)
out=$(sh "$setup")
[ "$(snapshot)" = "$before" ] && pass "dry run changes nothing" || fail "dry run changed files"
echo "$out" | grep -q "change move other global rules $HOME/.claude/CLAUDE.md" && pass "dry run lists CLAUDE.md" || fail "CLAUDE.md not listed"

touch "$HOME/.fail"
yes y | sh "$setup" --apply >/dev/null 2>&1 && fail "a failed install should exit 1" || pass "a failed install exits 1"
[ -f "$HOME/.claude/rules/00-global.md" ] && jq -e .advisorModel "$HOME/.claude/settings.json" >/dev/null && pass "steps after a failure still run" || fail "stopped at the failure"
rm "$HOME/.fail"
yes y | sh "$setup" --apply >/dev/null
[ -d "$HOME/.claude/skills/find-skills" ] && [ -d "$HOME/.agents/skills/orca-cli" ] && pass "find-skills and Orca skills for both agents" || fail "skills"
cmp -s "$HOME/.claude/rules/00-global.md" "$(dirname "$setup")/rules/global.md" && pass "Claude rules written" || fail "Claude rules"
cmp -s "$HOME/.codex/AGENTS.md" "$(dirname "$setup")/rules/global.md" && pass "Codex rules written" || fail "Codex rules"
[ ! -e "$HOME/.claude/CLAUDE.md" ] && [ ! -e "$HOME/.claude/rules/10-other.md" ] && [ ! -L "$HOME/.claude/skills/following-dev-workflow" ] &&
  pass "other rules and old links moved" || fail "other rules or links still there"
b=$(ls "$HOME/.config/benchkeeper/backup" | head -1)
[ -f "$HOME/.config/benchkeeper/backup/$b/.claude/CLAUDE.md" ] && pass "backup keeps the path below HOME" || fail "backup layout"
jq -e '.hooks.Stop == [] and .model == "opus" and .advisorModel == "opus" and .attribution.sessionUrl == false' "$HOME/.claude/settings.json" >/dev/null &&
  pass "settings merged, other keys kept" || fail "settings merge"
jq -e '.advisorModel == null and .model == "opus"' "$HOME/.config/benchkeeper/backup/$b/.claude/settings.json" >/dev/null && pass "old settings in the backup" || fail "settings backup"
[ "$(cat "$HOME/.dc")" = 1.0.0 ] && pass "host tool at the newest release older than 7 days" || fail "version pick"

out=$(sh "$setup" --apply </dev/null)
echo "$out" | grep -q '^change' && fail "second run still has changes: $(echo "$out" | grep '^change')" || pass "second run changes nothing"

echo "no" | sh "$setup" --apply >/dev/null 2>&1 || true
sh "$setup" --restore "$b" >/dev/null
[ "$(cat "$HOME/.claude/CLAUDE.md")" = "old rules" ] && pass "restore puts files back" || fail "restore"
[ "$(cat "$HOME/.codex/AGENTS.md")" = "my codex rules" ] && pass "restore replaces a file setup.sh wrote" || fail "restore of a replaced file"
sh "$setup" --restore ../x >/dev/null 2>&1 && fail "restore accepted ../x" || pass "restore rejects a path"
