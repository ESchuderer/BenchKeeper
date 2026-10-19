#!/bin/sh
# BenchKeeper machine setup for Claude Code and Codex: the global rules, settings, plugin installs, host checks, and a
# list of everything else installed globally (rules, skills, plugins, marketplaces, MCP servers, hooks), each removed
# only after a y. Run it yourself, it never runs on its own. Needs jq. Never uses sudo.
# Usage: setup.sh            dry run: prints the plan, changes nothing
#        setup.sh --apply    asks before each change (y to apply, anything else skips)
#        setup.sh --apply-all   applies every change of the dry run without asking, removals included
#        setup.sh --restore <name>   moves the files of a backup (~/.config/benchkeeper/backup/<name>) back
# Files are never deleted: anything replaced, edited or removed is first moved or copied to ~/.config/benchkeeper/backup/<date>/.
# Plugins, marketplaces and MCP servers are removed with the agent's own command, so undoing those means installing them again.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
rules=$here/rules/global.md
backups=$HOME/.config/benchkeeper/backup
stamp=$(date +%Y-%m-%d-%H%M%S)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
command -v jq >/dev/null || { echo "setup.sh needs jq" >&2; exit 1; }

restore() {
  case $1 in */* | . | .. | '') echo "bad backup name: $1 (one name from ls $backups)" >&2; exit 2 ;; esac
  src=$backups/$1
  [ -d "$src" ] || { echo "no backup $src" >&2; exit 1; }
  (cd "$src" && find . \( -type f -o -type l \) -print) | while IFS= read -r rel; do
    dest=$HOME/${rel#./}
    if [ -e "$dest" ] || [ -L "$dest" ]; then
      keep=$backups/$stamp-restore/${rel#./}
      mkdir -p "$(dirname "$keep")" && mv "$dest" "$keep" && echo "kept   the current $dest in $keep"
    fi
    mkdir -p "$(dirname "$dest")" && mv "$src/$rel" "$dest" && echo "back   $dest"
  done
}

mode=plan
case ${1:-} in
--apply) mode=apply ;;
--apply-all) mode=all ;;
--restore) restore "${2:?--restore needs a backup name, see ls $backups}"; exit 0 ;;
'') ;;
*) sed -n '5,8p' "$0" >&2; exit 2 ;;
esac

ok() { echo "ok     $1"; }
info() { echo "info   $1"; }
# step <text> <command...>: dry run prints the change, --apply asks for it and runs the command after a y, --apply-all runs it.
step() {
  text=$1; shift
  if [ "$mode" = plan ]; then echo "change $text"; return 0; fi
  if [ "$mode" = all ]; then echo "change $text"; answer=y; else
    printf 'change %s? [y/N] ' "$text"
    read -r answer || answer=
  fi
  case $answer in
  y | Y) if "$@"; then echo "done"; else echo "failed, continuing"; failed=1; fi ;;
  *) echo "skipped" ;;
  esac
}
failed=
# stash <path>: moves a file or link to the backup, keeping its path below $HOME.
stash() {
  dest=$backups/$stamp/${1#"$HOME"/}
  mkdir -p "$(dirname "$dest")" && mv "$1" "$dest"
}
# jqset <file> <filter>: applies the filter to the current file (or {}). The first change in a run copies the old file to the backup.
jqset() {
  if [ -f "$1" ]; then
    dest=$backups/$stamp/${1#"$HOME"/}
    mkdir -p "$(dirname "$dest")" && { [ -e "$dest" ] || cp -p "$1" "$dest"; } && jq "$2" "$1" >"$tmp/set.json"
  else
    mkdir -p "$(dirname "$1")" && echo '{}' | jq "$2" >"$tmp/set.json"
  fi && cp "$tmp/set.json" "$1"
}
# same <file> <filter>: the file exists and the filter changes nothing in it.
same() { [ -f "$1" ] && [ "$(jq -S . "$1")" = "$(jq -S "$2" "$1")" ]; }
put() { { [ ! -e "$2" ] && [ ! -L "$2" ]; } || stash "$2"; mkdir -p "$(dirname "$2")" && cp "$1" "$2"; }
# newest <pkg>: the highest release that has been public for at least 7 days, so a bad release is caught before it lands.
# Prints nothing when npm cannot answer or no release qualifies.
newest() {
  times=$(npm view "$1" time --json 2>/dev/null) || return 0
  echo "$times" | jq -r '(now - 604800 | todate) as $cut | (if type == "array" then add else . end) | del(.created, .modified)
    | to_entries | map(select(.value < $cut and (.key | test("^[0-9]+\\.[0-9]+\\.[0-9]+$"))))
    | sort_by(.key | split(".") | map(tonumber)) | last.key // empty' 2>/dev/null || true
}
# skill <repo> <name>: offers a global skill from the skills CLI for each present agent that lacks it.
skill() {
  flags=""
  [ -z "$claude" ] || [ -e "$HOME/.claude/skills/$2" ] || flags="$flags -a claude-code"
  [ -z "$codex" ] || [ -e "$HOME/.agents/skills/$2" ] || flags="$flags -a codex"
  if [ -z "$flags" ]; then ok "skill $2"; return 0; fi
  if [ -z "$skills_v" ]; then info "skill $2 missing, npm could not name a skills CLI release"; return 0; fi
  step "install the skill $2 from $1 (skills@$skills_v,$flags)" sh -c 'r=$1 n=$2 v=$3; shift 3
    DO_NOT_TRACK=1 npx -y "skills@$v" add "$r" -s "$n" -g "$@" --copy -y' _ "$1" "$2" "$skills_v" $flags
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
fi
if [ -n "$codex" ]; then
  have=$(codex plugin list --json | jq -r '.installed[] | select(.enabled) | .pluginId')
  for p in "benchkeeper@benchkeeper ESchuderer/BenchKeeper .claude-plugin,plugins" "ponytail@ponytail DietrichGebert/ponytail@v5.3.2" "mattpocock-skills@mattpocock mattpocock/skills"; do
    set -- $p
    if echo "$have" | grep -qx "$1"; then ok "Codex plugin $1"; else step "install the Codex plugin $1" install_codex "$1" "$2" "$(echo "${3:-}" | tr , ' ')"; fi
  done
fi

# Everything else installed globally: listed one by one and removed only after a y. Files go to the backup. Plugins,
# marketplaces and MCP servers are removed with the agent's own command. Loops read lists from variables, not pipes,
# so step can read the answer from the terminal.
nl='
'
IFS_old=$IFS
IFS=$nl
if [ -n "$claude" ]; then
  for s in "$HOME"/.claude/skills/*; do
    case ${s##*/} in find-skills | orca-cli | orchestration | synced) continue ;; esac
    { [ -e "$s" ] || [ -L "$s" ]; } && step "move the global skill $s to the backup" stash "$s"
  done
  for x in $(claude plugin list --json | jq -r '.[] | select(.scope == "user" or .scope == null) | .id'); do
    case $x in
    benchkeeper@benchkeeper | ponytail@ponytail | mattpocock-skills@claude-plugins-official | *@anthropic-plugin-directory) ;;
    *) step "uninstall the Claude plugin $x" claude plugin uninstall "$x" ;;
    esac
  done
  for x in $(claude plugin marketplace list --json | jq -r '.[].name'); do
    case $x in benchkeeper | ponytail | claude-plugins-official | anthropic-plugin-directory) ;;
    *) step "remove the Claude marketplace $x" claude plugin marketplace remove "$x" ;; esac
  done
  for x in $(jq -r '.mcpServers // {} | keys[]' "$HOME/.claude.json" 2>/dev/null); do
    step "remove the Claude user MCP server $x (projects configure their own)" claude mcp remove --scope user "$x"
  done
fi
if [ -n "$codex" ]; then
  for s in "$HOME"/.agents/skills/*; do
    case ${s##*/} in find-skills | orca-cli | orchestration) continue ;; esac
    { [ -e "$s" ] || [ -L "$s" ]; } && step "move the global skill $s to the backup" stash "$s"
  done
  for x in $(codex plugin list --json | jq -r '.installed[] | .pluginId'); do
    case $x in benchkeeper@benchkeeper | ponytail@ponytail | mattpocock-skills@mattpocock | *@openai-curated*) ;;
    *) step "remove the Codex plugin $x" codex plugin remove "$x" ;; esac
  done
  for x in $(codex plugin marketplace list --json | jq -r '.marketplaces[].name'); do
    case $x in benchkeeper | ponytail | mattpocock | openai-curated*) ;;
    *) step "remove the Codex marketplace $x" codex plugin marketplace remove "$x" ;; esac
  done
  for x in $(cd "$HOME" && codex mcp list --json | jq -r '.[].name'); do
    step "remove the Codex MCP server $x (projects configure their own)" sh -c 'cd "$HOME" && codex mcp remove "$1"' _ "$x"
  done
fi
# Hooks per event. Orca writes its own hooks back, so they are reported, not offered.
for f in ${claude:+"$HOME/.claude/settings.json"} ${codex:+"$HOME/.codex/hooks.json"}; do
  [ -f "$f" ] || continue
  orca=
  for e in $(jq -r '.hooks // {} | keys[]' "$f"); do
    keep=".hooks[\"$e\"] |= map(select(any(.hooks[]?; .command // \"\" | test(\"ORCA_\"))))"
    n=$(jq "$keep | .hooks[\"$e\"] | length" "$f")
    if [ "$n" -eq 0 ]; then keep="del(.hooks[\"$e\"])"; else orca="$orca $e"; fi
    if [ "$(jq ".hooks[\"$e\"] | length" "$f")" -gt "$n" ]; then
      step "remove the non-Orca $e hooks from $f (the old file goes to the backup)" jqset "$f" "$keep"
    fi
  done
  [ -z "$orca" ] || info "Orca hooks in $f:$orca (Orca manages them)"
done
f=$HOME/.codex/config.toml
[ -z "$codex" ] || [ ! -f "$f" ] || ! grep -q '^\[hooks' "$f" || info "hooks table in $f (Codex also runs these, edit by hand)"
IFS=$IFS_old

# Settings: merged into the existing files, other keys and hooks stay.
claude_keys='.advisorModel = "opus" | .remoteControlAtStartup = true | .showClearContextOnPlanAccept = true
  | .cleanupPeriodDays = 14 | .autoUpdatesChannel = "stable"
  | .attribution = {"commit": "Assisted-by: generative AI", "pr": "Created with the assistance of generative AI.", "sessionUrl": false}
  | .env = ((.env // {}) + {"DISABLE_ERROR_REPORTING": "1", "CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY": "1", "DISABLE_FEEDBACK_COMMAND": "1", "CLAUDE_CODE_SUBAGENT_MODEL": "sonnet"})'
if [ -n "$claude" ]; then
  f=$HOME/.claude/settings.json
  if same "$f" "$claude_keys"; then ok "Claude settings $f"; else
    step "set in $f: advisorModel opus, Remote Control on at startup, clear-context option on plan accept, local transcripts kept 14 days, stable update channel, neutral AI attribution without session link, error reporting, feedback survey and /feedback off, subagents without a model on Sonnet (other keys stay, the old file goes to the backup)" jqset "$f" "$claude_keys"
  fi
  # Default model opusplan: Opus in plan mode, Sonnet for the rest. Its own step, since it replaces a model the user chose.
  if same "$f" '.model = "opusplan"'; then ok "Claude default model opusplan"; else
    step "set the default model in $f to opusplan, Opus in plan mode and Sonnet otherwise (now: $(jq -r '.model // "unset"' "$f" 2>/dev/null || echo unset))" jqset "$f" '.model = "opusplan"'
  fi
  # Default effort high. In the user file Opus 5.5 and later ignore the top-level key, so the opusplan pair gets a
  # per-model level too (https://code.claude.com/docs/en/settings-reference#effortlevel).
  effort='.effortLevel = "high" | .modelSettings["claude-opus-5-5"].effortLevel = "high" | .modelSettings["claude-sonnet-5-5"].effortLevel = "high"'
  if same "$f" "$effort"; then ok "Claude default effort high"; else
    step "set the default effort in $f to high for all models, Opus 5.5 and Sonnet 5.5 included (now: $(jq -r '[.effortLevel // "unset", (.modelSettings["claude-opus-5-5"].effortLevel // "unset"), (.modelSettings["claude-sonnet-5-5"].effortLevel // "unset")] | join(", ")' "$f" 2>/dev/null || echo unset))" jqset "$f" "$effort"
  fi
  # Auto-compact at 400000 tokens instead of about 967K on 1M models: half the context resent per turn, same price per
  # token. No Anthropic recommendation or Claude 5 long-context data exists (CHANGELOG setup-v5.0). A level saved per
  # model with /autocompact outranks the key, so those are removed with it.
  compact='.autoCompactWindow = 400000 | if .modelSettings then .modelSettings |= (map_values(del(.autoCompactWindow)) | with_entries(select(.value != {}))) else . end'
  if same "$f" "$compact"; then ok "Claude auto-compact window 400000"; else
    step "set the auto-compact window in $f to 400000 tokens, per-model values removed (now: $(jq -r '[(.autoCompactWindow // "unset" | tostring)] + [.modelSettings // {} | to_entries[] | select(.value.autoCompactWindow) | "\(.key) \(.value.autoCompactWindow)"] | join(", ")' "$f" 2>/dev/null || echo unset))" jqset "$f" "$compact"
  fi
  [ -z "${CLAUDE_CODE_AUTO_COMPACT_WINDOW:-}" ] || info "CLAUDE_CODE_AUTO_COMPACT_WINDOW=$CLAUDE_CODE_AUTO_COMPACT_WINDOW in this shell outranks the setting (remove it where it is exported)"
fi
if [ -n "$codex" ]; then
  f=$HOME/.codex/config.toml
  for s in analytics feedback; do
    if [ -f "$f" ] && grep -q "^\[$s\]" "$f"; then ok "Codex [$s] in $f"; else
      step "add [$s] enabled = false to $f" sh -c 'mkdir -p "$(dirname "$1")" && printf "\n[%s]\nenabled = false\n" "$2" >>"$1"' _ "$f" "$s"
    fi
  done
  # Top-level key: replaced in place, or prepended so it stays above the first table.
  if [ -f "$f" ] && grep -qx 'model_reasoning_effort = "high"' "$f"; then ok "Codex default effort high"; else
    step "set model_reasoning_effort = \"high\" in $f (now: $(sed -n 's/^model_reasoning_effort = //p' "$f" 2>/dev/null | grep . || echo unset))" sh -c '
      mkdir -p "$(dirname "$1")" && touch "$1"
      if grep -q "^model_reasoning_effort" "$1"; then sed -i "s/^model_reasoning_effort = .*/model_reasoning_effort = \"high\"/" "$1"
      else { echo "model_reasoning_effort = \"high\""; cat "$1"; } >"$1.tmp" && mv "$1.tmp" "$1"; fi' _ "$f"
  fi
fi
f=$HOME/.config/ponytail/config.json
if same "$f" '.defaultMode = "full"'; then ok "Ponytail level full"; else
  step "set the Ponytail level to full in $f" jqset "$f" '.defaultMode = "full"'
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
  if [ -z "$want" ]; then info "npm could not name a Dev Containers CLI release (offline?), installed: ${have:-none}"
  elif [ "$have" = "$want" ]; then ok "Dev Containers CLI $have"; else
    step "install the Dev Containers CLI $want (installed: ${have:-none})" npm i -g "@devcontainers/cli@$want"
  fi
else
  info "npm not found: the Dev Containers CLI needs it (npm with a user prefix such as ~/.local)"
fi
if docker info >/dev/null 2>&1; then ok "container engine (docker info)"; elif command -v podman >/dev/null && podman info >/dev/null 2>&1; then
  ok "container engine (podman)"
else info "no container engine reachable: see https://docs.docker.com/engine/install/"; fi
skills_v=""
command -v npm >/dev/null && skills_v=$(newest skills)
skill vercel-labs/skills find-skills
command -v orca >/dev/null && skill https://github.com/stablyai/orca orca-cli && skill https://github.com/stablyai/orca orchestration
[ "$mode" = plan ] && echo "Dry run: nothing changed. Run with --apply to choose changes, or --apply-all to apply them all."
[ -d "$backups/$stamp" ] && echo "Backup: $backups/$stamp (undo with --restore $stamp)"
[ -z "$failed" ] || { echo "Some changes failed, see the lines marked failed." >&2; exit 1; }
exit 0
