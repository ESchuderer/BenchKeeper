#!/bin/sh
# Installs one arm's components for the node user, as /global-setup installs them, from pinned tags.
# A: stock. B: Ponytail. C: full rules, Ponytail, agent-skills, find-skills, BenchKeeper skills.
# D: base rules, Ponytail, Superpowers, find-skills, BenchKeeper skills. E: same with ECC minimal instead of Superpowers.
set -eu
arm=$1
src=$HOME/.bench-src
clone() { git -c advice.detachedHead=false clone -q --depth 1 --branch "$2" "https://github.com/$1.git" "$src/${1#*/}"; }
plugin() { clone "$1" "$2"; claude plugin marketplace add "$src/${1#*/}"; claude plugin install "$3"; }
mkdir -p "$src" "$HOME/.claude/rules" "$HOME/.claude/skills"
# Every arm: a no-op status line, as on the owner's machine; without one Ponytail asks the agent to set one up.
printf '{"statusLine":{"type":"command","command":"true"}}\n' > "$HOME/.claude/settings.json"

case $arm in A) exit 0 ;; B|C|D|E) ;; *) echo "unknown arm $arm" >&2; exit 1 ;; esac

plugin DietrichGebert/ponytail v5.2.0 ponytail@ponytail
mkdir -p "$HOME/.config/ponytail" && printf '{"defaultMode":"full"}\n' > "$HOME/.config/ponytail/config.json"
[ "$arm" = B ] && exit 0

clone vercel-labs/skills v1.7.2 && cp -r "$src/skills/skills/find-skills" "$HOME/.claude/skills/"
cp -r /opt/bench/skills/project-setup /opt/bench/skills/global-setup "$HOME/.claude/skills/"

case $arm in
  C) cp /opt/bench/global.md "$HOME/.claude/rules/00-global.md"
     plugin addyosmani/agent-skills 0.6.13 agent-skills@addy-agent-skills ;;
  D) cp /opt/bench/base.rules.md "$HOME/.claude/rules/00-global.md"
     plugin obra/superpowers v7.0.0 superpowers@superpowers-dev ;;
  E) cp /opt/bench/base.rules.md "$HOME/.claude/rules/00-global.md"
     DO_NOT_TRACK=1 npx -y ecc-universal@2.2.3 install --profile minimal --target claude ;;
esac
