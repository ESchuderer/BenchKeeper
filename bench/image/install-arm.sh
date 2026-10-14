#!/bin/sh
# Installs one arm's components for the node user, as /global-setup and /project-setup install them, from pinned tags.
# Arms (framework / Ponytail / BenchKeeper layer / spec tool):
#   A none/no/no/none          B none/yes/no/none
#   F agent-skills alone       G Superpowers alone        H ECC minimal alone
#   I agent-skills + OpenSpec  J Superpowers + OpenSpec   K ECC + OpenSpec
#   L agent-skills + BK        M Superpowers + BK         N ECC + BK
#   C agent-skills + BK + OpenSpec   D Superpowers + BK + OpenSpec   E ECC + BK + OpenSpec
#   O Ponytail + OpenSpec      P Ponytail + Spec Kit
# BenchKeeper layer (BK): rules (agent-skills: rules/global.md; Superpowers, ECC: its variant with the framework's own
# flow), candidate rules, Ponytail, find-skills, BenchKeeper skills, Playwright MCP with Chromium, and a project set up
# by /project-setup. Arms with a project start from ~/project-template (copied in by the runner as the first commit).
set -eu
arm=$1
case $arm in
  A) fw=none bk=no pt=no spec=none ;;          B) fw=none bk=no pt=yes spec=none ;;
  F) fw=as bk=no pt=no spec=none ;;            G) fw=sp bk=no pt=no spec=none ;;            H) fw=ecc bk=no pt=no spec=none ;;
  I) fw=as bk=no pt=no spec=openspec ;;        J) fw=sp bk=no pt=no spec=openspec ;;        K) fw=ecc bk=no pt=no spec=openspec ;;
  L) fw=as bk=yes pt=yes spec=none ;;          M) fw=sp bk=yes pt=yes spec=none ;;          N) fw=ecc bk=yes pt=yes spec=none ;;
  C) fw=as bk=yes pt=yes spec=openspec ;;      D) fw=sp bk=yes pt=yes spec=openspec ;;      E) fw=ecc bk=yes pt=yes spec=openspec ;;
  O) fw=none bk=no pt=yes spec=openspec ;;     P) fw=none bk=no pt=yes spec=speckit ;;
  *) echo "unknown arm $arm" >&2; exit 1 ;;
esac
src=$HOME/.bench-src
clone() { git -c advice.detachedHead=false clone -q --depth 1 --branch "$2" "https://github.com/$1.git" "$src/${1#*/}"; }
plugin() { clone "$1" "$2"; claude plugin marketplace add "$src/${1#*/}"; claude plugin install "$3"; }
mkdir -p "$src" "$HOME/.claude/rules" "$HOME/.claude/skills"
# Every arm: a no-op status line, as on the owner's machine; without one Ponytail asks the agent to set one up.
printf '{"statusLine":{"type":"command","command":"true"}}\n' > "$HOME/.claude/settings.json"
git config --global user.name agent && git config --global user.email agent@localhost && git config --global init.defaultBranch main

case $fw in
  as) plugin addyosmani/agent-skills 0.6.13 agent-skills@addy-agent-skills ;;
  sp) plugin obra/superpowers v7.0.0 superpowers@superpowers-dev ;;
  ecc) DO_NOT_TRACK=1 npx -y ecc-universal@2.2.3 install --profile minimal --target claude ;;
esac
if [ "$pt" = yes ]; then
  plugin DietrichGebert/ponytail v5.2.0 ponytail@ponytail
  mkdir -p "$HOME/.config/ponytail" && printf '{"defaultMode":"full"}\n' > "$HOME/.config/ponytail/config.json"
fi

t=$HOME/project-template
if [ "$bk" = yes ]; then
  case $fw in as) rules=global.md ;; sp) rules=superpowers.rules.md ;; ecc) rules=ecc.rules.md ;; esac
  cp "/opt/bench/$rules" "$HOME/.claude/rules/00-global.md"
  cp /opt/bench/candidate.rules.md "$HOME/.claude/rules/01-candidate.md"
  clone vercel-labs/skills v1.7.2 && cp -r "$src/skills/skills/find-skills" "$HOME/.claude/skills/"
  cp -r /opt/bench/skills/project-setup /opt/bench/skills/global-setup "$HOME/.claude/skills/"
  npm i -g --prefix "$HOME/.local" @playwright/mcp@0.0.83
  node "$HOME/.local/lib/node_modules/@playwright/mcp/node_modules/playwright-core/cli.js" install chromium
  cp -r /opt/bench/project-setup "$t" && rm "$t/README.md"
  # Without OpenSpec the project has no spec-tool convention.
  [ "$spec" = openspec ] || sed -i '/^## Conventions/,$d' "$t/AGENTS.md"
  (cd "$t" && DO_NOT_TRACK=1 npx -y skills@1.7.2 add https://github.com/currents-dev/playwright-best-practices-skill/tree/283d5cbc5d11aac1abda058b16ad22c317d54dc0 -s playwright-best-practices -a claude-code --copy -y)
fi
case $spec in
  openspec)
    npm i -g --prefix "$HOME/.local" @fission-ai/openspec@1.14.1
    openspec config set delivery skills >/dev/null && openspec config set telemetry.enabled false >/dev/null
    mkdir -p "$t" && (cd "$t" && openspec init --tools claude --no-animation >/dev/null) ;;
  speckit)
    uv tool install -q specify-cli --from git+https://github.com/github/spec-kit.git@v1.2.0
    mkdir -p "$t" && (cd "$t" && specify init --here --integration claude --script sh --force --non-interactive --ignore-agent-tools >/dev/null) ;;
esac
