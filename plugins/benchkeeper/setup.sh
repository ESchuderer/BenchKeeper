#!/bin/sh
# BenchKeeper machine setup for Claude Code and Codex: the global rules, settings, plugin installs, host checks, and a
# scan for other global rules. Run it yourself, it never runs on its own. Needs jq. Never uses sudo.
# Usage: setup.sh            dry run: prints the plan, changes nothing
#        setup.sh --apply    asks before each change (y to apply, anything else skips)
#        setup.sh --restore <name>   moves the files of a backup (~/.config/benchkeeper/backup/<name>) back
# Files are never deleted: anything replaced or removed is moved to ~/.config/benchkeeper/backup/<date>/ first.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
rules=$here/rules/global.md
backups=$HOME/.config/benchkeeper/backup
stamp=$(date +%Y-%m-%d-%H%M%S)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
command -v jq >/dev/null || { echo "setup.sh needs jq" >&2; exit 1; }

restore() {
  src=$backups/$1
  [ -d "$src" ] || { echo "no backup $src" >&2; exit 1; }
  (cd "$src" && find . \( -type f -o -type l \) -print) | while IFS= read -r rel; do
    dest=$HOME/${rel#./}
    if [ -e "$dest" ] || [ -L "$dest" ]; then echo "skip   $dest exists"; continue; fi
    mkdir -p "$(dirname "$dest")" && mv "$src/$rel" "$dest" && echo "back   $dest"
  done
}

mode=plan
case ${1:-} in
--apply) mode=apply ;;
--restore) restore "${2:?--restore needs a backup name, see ls $backups}"; exit 0 ;;
'') ;;
*) sed -n '4,7p' "$0" >&2; exit 2 ;;
esac

ok() { echo "ok     $1"; }
info() { echo "info   $1"; }
# step <text> <command...>: dry run prints the change, --apply asks for it and runs the command after a y.
step() {
  text=$1; shift
  if [ "$mode" = plan ]; then echo "change $text"; return 0; fi
  printf 'change %s? [y/N] ' "$text"
  read -r answer || answer=
  case $answer in y | Y) "$@" && echo "done" ;; *) echo "skipped" ;; esac
}
# stash <path>: moves a file or link to the backup, keeping its path below $HOME.
stash() {
  dest=$backups/$stamp/${1#"$HOME"/}
  mkdir -p "$(dirname "$dest")" && mv "$1" "$dest"
}
put() { { [ ! -e "$2" ] && [ ! -L "$2" ]; } || stash "$2"; mkdir -p "$(dirname "$2")" && cp "$1" "$2"; }
# newest <pkg>: the newest release that has been public for at least 7 days, so a bad release is caught before it lands.
newest() {
  npm view "$1" time --json | jq -r '(now - 604800 | todate) as $cut | (if type == "array" then add else . end) | del(.created, .modified) | to_entries
    | map(select(.value < $cut and (.key | test("^[0-9]+\\.[0-9]+\\.[0-9]+$")))) | sort_by(.value) | last.key'
}

claude=$(command -v claude || true)
codex=$(command -v codex || true)
[ -n "$claude$codex" ] || { echo "neither claude nor codex found" >&2; exit 1; }

# Rules: a copy, since the plugin directory changes with each version.
if [ -n "$claude" ]; then
  f=$HOME/.claude/rules/00-global.md
  if [ ! -L "$f" ] && cmp -s "$rules" "$f"; then ok "Claude rules $f"; else step "write the Claude rules $f" put "$rules" "$f"; fi
  for f in "$HOME"/.claude/rules/* "$HOME/.claude/CLAUDE.md"; do
    case $f in */00-global.md | */rules/\*) continue ;; esac
    [ ! -e "$f" ] || step "move other global rules $f ($(wc -l <"$f") lines) to the backup" stash "$f"
  done
fi
if [ -n "$codex" ]; then
  f=$HOME/.codex/AGENTS.md
  if cmp -s "$rules" "$f"; then ok "Codex rules $f"; else step "write the Codex rules $f (an existing file goes to the backup)" put "$rules" "$f"; fi
  f=$HOME/.codex/AGENTS.override.md
  [ ! -e "$f" ] || step "move other global rules $f ($(wc -l <"$f") lines) to the backup" stash "$f"
fi

# Skill links of setup-v3 and earlier: the plugin replaces them.
for d in "$HOME/.claude/skills" "$HOME/.agents/skills"; do
  for n in following-dev-workflow setting-up-machine setting-up-projects maintaining-repos sdlc maintain global-setup project-setup; do
    [ ! -L "$d/$n" ] || step "move the old skill link $d/$n to the backup (the plugin replaces it)" stash "$d/$n"
  done
done

# Plugins: BenchKeeper, Matt Pocock's skills and Ponytail, installed the way each project documents it. Ponytail runs a
# SessionStart hook, so its marketplace is pinned to a tag (Claude #ref, Codex @ref) and bumped on purpose.
install_claude() { claude plugin marketplace add "$2" ${3:+--sparse $3} && claude plugin install "$1"; }
install_codex() { codex plugin marketplace add "$2" ${3:+--sparse ${3% *} --sparse ${3#* }} && codex plugin add "$1"; }
if [ -n "$claude" ]; then
  have=$(claude plugin list --json | jq -r '.[] | select(.enabled) | .id')
  for p in "benchkeeper@benchkeeper ESchuderer/BenchKeeper .claude-plugin,plugins" "ponytail@ponytail DietrichGebert/ponytail#v5.3.2"; do
    set -- $p
    if echo "$have" | grep -qx "$1"; then ok "Claude plugin $1"; else step "install the Claude plugin $1" install_claude "$1" "$2" "$(echo "${3:-}" | tr , ' ')"; fi
  done
  p=mattpocock-skills@claude-plugins-official
  if echo "$have" | grep -qx "$p"; then ok "Claude plugin $p"; else step "install the Claude plugin $p" claude plugin install "$p"; fi
  echo "$have" | grep -vx -e benchkeeper@benchkeeper -e ponytail@ponytail -e "$p" | grep -v "@anthropic-plugin-directory$" | while IFS= read -r x; do
    [ -z "$x" ] || info "other Claude plugin $x (remove: claude plugin uninstall $x)"
  done
fi
if [ -n "$codex" ]; then
  have=$(codex plugin list --json | jq -r '.installed[] | select(.enabled) | .pluginId')
  for p in "benchkeeper@benchkeeper ESchuderer/BenchKeeper .claude-plugin,plugins" "ponytail@ponytail DietrichGebert/ponytail@v5.3.2" "mattpocock-skills@mattpocock mattpocock/skills"; do
    set -- $p
    if echo "$have" | grep -qx "$1"; then ok "Codex plugin $1"; else step "install the Codex plugin $1" install_codex "$1" "$2" "$(echo "${3:-}" | tr , ' ')"; fi
  done
  echo "$have" | grep -vx -e benchkeeper@benchkeeper -e ponytail@ponytail -e mattpocock-skills@mattpocock | grep -v "@openai-curated-remote$" | while IFS= read -r x; do
    [ -z "$x" ] || info "other Codex plugin $x (remove: codex plugin remove $x)"
  done
fi

# Settings: merged into the existing files, other keys and hooks stay.
merge() { cp "$2" "$1"; }
if [ -n "$claude" ]; then
  f=$HOME/.claude/settings.json
  [ -f "$f" ] && cp "$f" "$tmp/old.json" || echo '{}' >"$tmp/old.json"
  jq '.advisorModel = "opus" | .remoteControlAtStartup = true | .showClearContextOnPlanAccept = true
    | .autoCompactWindow = (.autoCompactWindow // 400000)
    | .attribution = {"commit": "Assisted-by: generative AI", "pr": "Created with the assistance of generative AI.", "sessionUrl": false}
    | .env = ((.env // {}) + {"DISABLE_ERROR_REPORTING": "1", "CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY": "1"})' "$tmp/old.json" >"$tmp/new.json"
  if [ -f "$f" ] && [ "$(jq -S . "$f")" = "$(jq -S . "$tmp/new.json")" ]; then ok "Claude settings $f"; else
    step "merge the BenchKeeper keys into $f (attribution, advisor, telemetry off)" merge "$f" "$tmp/new.json"
  fi
fi
if [ -n "$codex" ]; then
  f=$HOME/.codex/config.toml
  for s in analytics feedback; do
    if [ -f "$f" ] && grep -q "^\[$s\]" "$f"; then ok "Codex [$s] in $f"; else
      step "add [$s] enabled = false to $f" sh -c 'mkdir -p "$(dirname "$1")" && printf "\n[%s]\nenabled = false\n" "$2" >>"$1"' _ "$f" "$s"
    fi
  done
fi
f=$HOME/.config/ponytail/config.json
if [ -f "$f" ] && [ "$(jq -r .defaultMode "$f")" = full ]; then ok "Ponytail level full"; else
  [ -f "$f" ] && cp "$f" "$tmp/p.json" || echo '{}' >"$tmp/p.json"
  jq '.defaultMode = "full"' "$tmp/p.json" >"$tmp/p2.json"
  step "set the Ponytail level to full in $f" sh -c 'mkdir -p "$(dirname "$1")" && cp "$2" "$1"' _ "$f" "$tmp/p2.json"
fi

# Variables that switch off the advisor or Remote Control: reported with their place, edited by hand.
vars='DISABLE_TELEMETRY|DO_NOT_TRACK|CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC|DISABLE_GROWTHBOOK|CLAUDE_CODE_DISABLE_ADVISOR_TOOL'
env | grep -E "^($vars)=" | while IFS= read -r x; do info "set in this shell: $x (remove it where it is exported)"; done
[ -f "$HOME/.claude/settings.json" ] && jq -r '.env // {} | keys[]' "$HOME/.claude/settings.json" | grep -E "^($vars)$" |
  while IFS= read -r x; do info "set in ~/.claude/settings.json env: $x"; done
for f in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile" /etc/environment; do
  [ ! -f "$f" ] || grep -nE "$vars" "$f" | while IFS= read -r x; do info "$f:$x"; done
done
[ -d "$HOME/.config/fish" ] && grep -rnE "$vars" "$HOME/.config/fish" | while IFS= read -r x; do info "$x"; done

# Host tools and checks.
if command -v npm >/dev/null; then
  want=$(newest @devcontainers/cli)
  have=$(devcontainer --version 2>/dev/null || true)
  if [ "$have" = "$want" ]; then ok "Dev Containers CLI $have"; else
    step "install the Dev Containers CLI $want (installed: ${have:-none})" npm i -g "@devcontainers/cli@$want"
  fi
else
  info "npm not found: the Dev Containers CLI needs it (npm with a user prefix such as ~/.local)"
fi
if docker info >/dev/null 2>&1; then ok "container engine (docker info)"; elif command -v podman >/dev/null && podman info >/dev/null 2>&1; then
  ok "container engine (podman)"
else info "no container engine reachable: see https://docs.docker.com/engine/install/"; fi
if [ -n "$claude" ]; then
  claude mcp list 2>/dev/null | grep -i '^playwright' | grep -v devcontainer | while IFS= read -r x; do
    info "host Playwright MCP: ${x%%:*} (projects run it in their devcontainer, see setting-up-projects)"
  done
fi
if command -v orca >/dev/null && [ ! -e "$HOME/.claude/skills/orca-cli" ] && [ ! -e "$HOME/.agents/skills/orca-cli" ]; then
  v=$(newest skills)
  step "install the optional Orca skills orca-cli and orchestration (skills@$v)" sh -c '
    for s in orca-cli orchestration; do
      DO_NOT_TRACK=1 npx -y "skills@$1" add https://github.com/stablyai/orca -s "$s" -g -a claude-code -a codex --copy -y || exit 1
    done' _ "$v"
fi
for f in "$HOME/.claude/RTK.md" "$HOME/.codex/RTK.md"; do
  [ ! -e "$f" ] || step "move the RTK leftover $f to the backup" stash "$f"
done
[ "$mode" = plan ] && echo "Dry run: nothing changed. Run with --apply to choose changes."
[ -d "$backups/$stamp" ] && echo "Backup: $backups/$stamp (undo with --restore $stamp)"
exit 0
