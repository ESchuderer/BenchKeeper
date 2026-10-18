#!/bin/sh
# Self-check for setup.sh against a temporary HOME, with stub claude, codex, npm and devcontainer commands. No network.
set -eu
setup=$(cd "$(dirname "$0")" && pwd)/setup.sh
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
export HOME="$t/home" PATH="$t/bin:$PATH"
mkdir -p "$HOME" "$t/bin"
stub() { printf '#!/bin/sh\n%s\n' "$2" >"$t/bin/$1"; chmod +x "$t/bin/$1"; }
# Plugins count as installed once the stub saw an install. Each agent also has one foreign plugin, marketplace and MCP
# server. A removal leaves a marker file that hides it. npm knows one release older and one newer than 7 days.
cat >"$t/bin/claude" <<'EOF'
#!/bin/sh
case "$*" in
"plugin list --json")
  l='{"id":"other@x","enabled":true,"scope":"user"}'
  [ -f "$HOME/.c-pu" ] && l='{"id":"other@x","enabled":false,"scope":"project"}'
  [ -f "$HOME/.c" ] && l="$l"',{"id":"benchkeeper@benchkeeper","enabled":true,"scope":"user"},{"id":"ponytail@ponytail","enabled":true,"scope":"user"},{"id":"mattpocock-skills@claude-plugins-official","enabled":true,"scope":"user"}'
  echo "[$l]" ;;
"plugin uninstall other@x") touch "$HOME/.c-pu" ;;
"plugin marketplace list --json") [ -f "$HOME/.c-mr" ] && echo '[{"name":"ponytail"}]' || echo '[{"name":"ponytail"},{"name":"old"}]' ;;
"plugin marketplace remove old") touch "$HOME/.c-mr" ;;
"mcp remove --scope user extra") jq 'del(.mcpServers.extra)' "$HOME/.claude.json" >"$HOME/.cj" && mv "$HOME/.cj" "$HOME/.claude.json" ;;
"plugin install"*) touch "$HOME/.c" ;;
esac
EOF
cat >"$t/bin/codex" <<'EOF'
#!/bin/sh
case "$*" in
"plugin list --json")
  l='{"pluginId":"other@x","enabled":true}'
  [ -f "$HOME/.x-pu" ] && l=
  [ -f "$HOME/.x" ] && l="${l:+$l,}"'{"pluginId":"benchkeeper@benchkeeper","enabled":true},{"pluginId":"ponytail@ponytail","enabled":true},{"pluginId":"mattpocock-skills@mattpocock","enabled":true}'
  echo "{\"installed\":[$l]}" ;;
"plugin remove other@x") touch "$HOME/.x-pu" ;;
"plugin marketplace list --json") echo '{"marketplaces":[{"name":"ponytail"}]}' ;;
"mcp list --json") [ -f "$HOME/.x-mcp" ] && echo '[]' || echo '[{"name":"extra"}]' ;;
"mcp remove extra") touch "$HOME/.x-mcp" ;;
"plugin add"*) [ ! -f "$HOME/.fail" ] && touch "$HOME/.x" ;;
esac
EOF
chmod +x "$t/bin/claude" "$t/bin/codex"
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
mkdir -p "$HOME/.agents/skills/old-skill"
echo '{"mcpServers":{"extra":{"command":"x"}}}' >"$HOME/.claude.json"
echo '{"hooks":{"Stop":[{"hooks":[{"command":"echo mine"}]}],"SessionStart":[{"hooks":[{"command":"ORCA_AGENT_HOOK_PORT=1 x"}]}],"PreToolUse":[{"hooks":[{"command":"ORCA_AGENT_HOOK_PORT=1 y"}]},{"hooks":[{"command":"echo mine too"}]}],"PostToolUse":[]},"model":"opus","autoCompactWindow":600000,"modelSettings":{"claude-opus-5-5":{"autoCompactWindow":800000,"effortLevel":"high"},"claude-fable-5-1":{"autoCompactWindow":"auto"}}}' >"$HOME/.claude/settings.json"
printf '[analytics]\nenabled = false\n' >"$HOME/.codex/config.toml"
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
  [ ! -e "$HOME/.agents/skills/old-skill" ] && pass "other rules and global skills moved" || fail "other rules or skills still there"
[ -f "$HOME/.c-pu" ] && [ -f "$HOME/.c-mr" ] && [ -f "$HOME/.x-pu" ] && [ -f "$HOME/.x-mcp" ] && jq -e '.mcpServers == {}' "$HOME/.claude.json" >/dev/null &&
  pass "other plugins, marketplaces and MCP servers removed" || fail "other plugins, marketplaces or MCP servers"
b=$(ls "$HOME/.config/benchkeeper/backup" | head -1)
[ -f "$HOME/.config/benchkeeper/backup/$b/.claude/CLAUDE.md" ] && pass "backup keeps the path below HOME" || fail "backup layout"
jq -e '.hooks.Stop == null and .hooks.SessionStart != null and (.hooks.PreToolUse | length) == 1 and .hooks.PostToolUse == [] and .model == "opusplan" and .advisorModel == "opus" and .attribution.sessionUrl == false' "$HOME/.claude/settings.json" >/dev/null &&
  pass "other hooks removed, Orca hooks and other keys kept, model opusplan" || fail "settings merge or hooks"
jq -e '.advisorModel == null and .model == "opus" and .hooks.Stop != null' "$HOME/.config/benchkeeper/backup/$b/.claude/settings.json" >/dev/null && pass "old settings in the backup" || fail "settings backup"
jq -e '.cleanupPeriodDays == 14 and .autoUpdatesChannel == "stable" and .env.DISABLE_FEEDBACK_COMMAND == "1" and .env.CLAUDE_CODE_SUBAGENT_MODEL == "sonnet"' "$HOME/.claude/settings.json" >/dev/null && pass "transcripts 14 days, stable channel, /feedback off, subagents on Sonnet" || fail "privacy or cost settings"
jq -e '.autoCompactWindow == 400000 and .effortLevel == "medium" and .modelSettings == {"claude-opus-5-5":{"effortLevel":"medium"},"claude-sonnet-5-5":{"effortLevel":"medium"}}' "$HOME/.claude/settings.json" >/dev/null &&
  pass "effort medium, auto-compact 400000, per-model windows removed" || fail "effort or auto-compact"
[ "$(head -1 "$HOME/.codex/config.toml")" = 'model_reasoning_effort = "medium"' ] && grep -q '^\[analytics\]' "$HOME/.codex/config.toml" && pass "Codex effort medium above the tables" || fail "Codex effort"
[ "$(cat "$HOME/.dc")" = 1.0.0 ] && pass "host tool at the newest release older than 7 days" || fail "version pick"

out=$(sh "$setup" --apply </dev/null)
echo "$out" | grep -q '^change' && fail "second run still has changes: $(echo "$out" | grep '^change')" || pass "second run changes nothing"

echo "no" | sh "$setup" --apply >/dev/null 2>&1 || true
sh "$setup" --restore "$b" >/dev/null
[ "$(cat "$HOME/.claude/CLAUDE.md")" = "old rules" ] && pass "restore puts files back" || fail "restore"
[ "$(cat "$HOME/.codex/AGENTS.md")" = "my codex rules" ] && pass "restore replaces a file setup.sh wrote" || fail "restore of a replaced file"
sh "$setup" --restore ../x >/dev/null 2>&1 && fail "restore accepted ../x" || pass "restore rejects a path"

rm -rf "$HOME" && mkdir -p "$HOME/.claude" "$HOME/.codex"
out=$(sh "$setup" --apply-all </dev/null 2>&1) || true
jq -e '.model == "opusplan" and .autoCompactWindow == 400000' "$HOME/.claude/settings.json" >/dev/null && pass "--apply-all applies without asking" || fail "--apply-all: $out"
echo "$out" | grep -q '\[y/N\]' && fail "--apply-all asked" || pass "--apply-all prints no question"
