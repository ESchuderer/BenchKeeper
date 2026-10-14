#!/bin/sh
# Installs one arm's components for the node user, as /global-setup installs them, from pinned tags.
# A: stock. B: Ponytail. F, G, H: one framework alone (agent-skills, Superpowers, ECC minimal).
# C, D, E: the same frameworks with BenchKeeper: rules (C rules/global.md; D and E its variant with the framework's own flow), Ponytail, find-skills,
# BenchKeeper skills, OpenSpec CLI, Playwright MCP with Chromium, and ~/project-template, the workspace state
# /project-setup leaves (copied in by the runner).
set -eu
arm=$1
src=$HOME/.bench-src
clone() { git -c advice.detachedHead=false clone -q --depth 1 --branch "$2" "https://github.com/$1.git" "$src/${1#*/}"; }
plugin() { clone "$1" "$2"; claude plugin marketplace add "$src/${1#*/}"; claude plugin install "$3"; }
agent_skills() { plugin addyosmani/agent-skills 0.6.13 agent-skills@addy-agent-skills; }
superpowers() { plugin obra/superpowers v7.0.0 superpowers@superpowers-dev; }
ecc() { DO_NOT_TRACK=1 npx -y ecc-universal@2.2.3 install --profile minimal --target claude; }
mkdir -p "$src" "$HOME/.claude/rules" "$HOME/.claude/skills"
# Every arm: a no-op status line, as on the owner's machine; without one Ponytail asks the agent to set one up.
printf '{"statusLine":{"type":"command","command":"true"}}\n' > "$HOME/.claude/settings.json"
git config --global user.name agent && git config --global user.email agent@localhost && git config --global init.defaultBranch main

case $arm in
  A) exit 0 ;;
  F) agent_skills; exit 0 ;;
  G) superpowers; exit 0 ;;
  H) ecc; exit 0 ;;
  B|C|D|E) ;;
  *) echo "unknown arm $arm" >&2; exit 1 ;;
esac

plugin DietrichGebert/ponytail v5.2.0 ponytail@ponytail
mkdir -p "$HOME/.config/ponytail" && printf '{"defaultMode":"full"}\n' > "$HOME/.config/ponytail/config.json"
[ "$arm" = B ] && exit 0

clone vercel-labs/skills v1.7.2 && cp -r "$src/skills/skills/find-skills" "$HOME/.claude/skills/"
cp -r /opt/bench/skills/project-setup /opt/bench/skills/global-setup "$HOME/.claude/skills/"
case $arm in
  C) cp /opt/bench/global.md "$HOME/.claude/rules/00-global.md"; agent_skills ;;
  D) cp /opt/bench/superpowers.rules.md "$HOME/.claude/rules/00-global.md"; superpowers ;;
  E) cp /opt/bench/ecc.rules.md "$HOME/.claude/rules/00-global.md"; ecc ;;
esac
cp /opt/bench/candidate.rules.md "$HOME/.claude/rules/01-candidate.md"

npm i -g --prefix "$HOME/.local" @fission-ai/openspec@1.14.1 @playwright/mcp@0.0.83
node "$HOME/.local/lib/node_modules/@playwright/mcp/node_modules/playwright-core/cli.js" install chromium
openspec config set delivery skills >/dev/null && openspec config set telemetry.enabled false >/dev/null
t=$HOME/project-template && cp -r /opt/bench/project-setup "$t" && rm "$t/README.md"
(cd "$t" && openspec init --tools claude --no-animation >/dev/null)
(cd "$t" && DO_NOT_TRACK=1 npx -y skills@1.7.2 add https://github.com/currents-dev/playwright-best-practices-skill/tree/283d5cbc5d11aac1abda058b16ad22c317d54dc0 -s playwright-best-practices -a claude-code --copy -y)
