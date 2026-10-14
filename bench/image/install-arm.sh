#!/bin/sh
# Installs one arm's components for the node user, as /global-setup and /project-setup install them, from pinned tags.
# Arms (framework / Ponytail / BenchKeeper layer / spec tool):
#   A none/no/no/none          B none/yes/no/none
#   F agent-skills alone       G Superpowers alone        H ECC minimal alone
#   I agent-skills + OpenSpec  J Superpowers + OpenSpec   K ECC + OpenSpec
#   L agent-skills + BK        M Superpowers + BK         N ECC + BK
#   C agent-skills + BK + OpenSpec   D Superpowers + BK + OpenSpec   E ECC + BK + OpenSpec
#   O Ponytail + OpenSpec      P Ponytail + Spec Kit      AB OpenSpec alone      AC Spec Kit alone
# BenchKeeper layer (BK): rules (agent-skills: rules/global.md; Superpowers, ECC: its variant with the framework's own
# flow), candidate rules, Ponytail, find-skills, BenchKeeper skills, Playwright MCP with Chromium, and a project set up
# by /project-setup. Arms with a project start from ~/project-template (copied in by the runner as the first commit).
set -eu
arm=$1

# Matt Pocock's one-time /setup-matt-pocock-skills, as its recommended answers give it (local markdown issue tracker,
# default triage labels, single-context domain docs), from the seed templates at v1.3.1: docs/agents/ plus the
# "## Agent skills" block in CLAUDE.md, or in <file> when given (it creates the file when neither exists).
mp_setup() {
  s=$src/mattpocock-skills/skills/engineering/setup-matt-pocock-skills
  mkdir -p "$t/docs/agents"
  cp "$s/issue-tracker-local.md" "$t/docs/agents/issue-tracker.md"
  cp "$s/triage-labels.md" "$s/domain.md" "$t/docs/agents/"
  f=${1:-CLAUDE.md}; [ -e "$t/CLAUDE.md" ] && f=CLAUDE.md
  cat /opt/bench/mattpocock-agent-skills.md >> "$t/$f"
}

# OpenCode arms (runtime OpenCode 1.19.0 instead of Claude Code; Anthropic API key at run time, not the subscription):
#   Q OpenSpec + targeted skills (addy TDD, security, review, debugging; Vercel React)   R Superpowers (OpenCode plugin)
#   S OpenSpec + Superpowers through oso 1.1.1 (its own Superpowers v6.1.1)               T agent-skills (all, AGENTS.md template)
#   U agent-skills without its define/plan lifecycle skills + OpenSpec
#   Z Matt Pocock's skills (v1.3.1, the 27 plugin skills)  AA Matt Pocock's skills + OpenSpec
# Isolation: OPENCODE_DISABLE_CLAUDE_CODE and OPENCODE_DISABLE_EXTERNAL_SKILLS (no ~/.claude or .agents loading), no
# autoupdate, no model catalog fetch at run time (fetched once here). The runner sets the same variables for every turn.
opencode_arm() {
  export OPENCODE_DISABLE_CLAUDE_CODE=1 OPENCODE_DISABLE_EXTERNAL_SKILLS=1 OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_LSP_DOWNLOAD=1
  src=$HOME/.bench-src; t=$HOME/project-template
  mkdir -p "$src" "$t" "$HOME/.config/opencode"
  git config --global user.name agent && git config --global user.email agent@localhost && git config --global init.defaultBranch main
  npm i -g --prefix "$HOME/.local" opencode-ai@1.19.0
  printf '{"$schema":"https://opencode.ai/config.json","autoupdate":false,"share":"disabled","plugin":[]}\n' > "$HOME/.config/opencode/opencode.json"
  # Model catalog, fetched once (the bundled snapshot of 1.19.0 lacks the 5.5 models).
  (cd /tmp && ANTHROPIC_API_KEY=dummy command opencode models anthropic | grep -q 'anthropic/claude-haiku-5-5')
  addy() { # <target skills dir> [skills to leave out...]: agent-skills 0.6.13 skills and the references they link to
    [ -d "$src/agent-skills" ] || git -c advice.detachedHead=false clone -q --depth 1 --branch 0.6.13 https://github.com/addyosmani/agent-skills "$src/agent-skills"
    d=$1; shift; mkdir -p "$d"; cp -r "$src/agent-skills/skills/." "$d/"; cp -r "$src/agent-skills/references" "$d/../references"
    for x in "$@"; do rm -r "${d:?}/$x"; done
  }
  openspec_project() { # OpenSpec 1.14.1 with verify in the profile, initialised for OpenCode
    npm i -g --prefix "$HOME/.local" @fission-ai/openspec@1.14.1
    command openspec config set telemetry.enabled false >/dev/null
    command openspec config set profile custom >/dev/null
    command openspec config set workflows '["propose","explore","apply","verify","archive"]' >/dev/null
    (cd "$t" && OPENSPEC_TELEMETRY=0 command openspec init --tools opencode --no-animation >/dev/null)
  }
  clone() { git -c advice.detachedHead=false clone -q --depth 1 --branch "$2" "https://github.com/$1.git" "$src/$(echo "$1" | tr / -)"; }
  case $1 in
    Q) openspec_project
       addy "$t/.opencode/skills"
       (cd "$t/.opencode/skills" && for x in *; do case $x in test-driven-development|security-and-hardening|code-review-and-quality|debugging-and-error-recovery|openspec-*) ;; *) rm -r "$x" ;; esac; done)
       git init -q "$src/vercel" && git -C "$src/vercel" fetch -q --depth 1 https://github.com/vercel-labs/agent-skills 063bee94c3f4df8453406c830b0a7df0f2860278 && git -C "$src/vercel" -c advice.detachedHead=false checkout -q FETCH_HEAD
       cp -r "$src/vercel/skills/react-best-practices" "$t/.opencode/skills/vercel-react-best-practices" ;;
    R) git -c advice.detachedHead=false clone -q --depth 1 --branch v7.0.0 https://github.com/obra/superpowers "$src/superpowers"
       test "$(git -C "$src/superpowers" rev-parse HEAD)" = bb92a77741419a4ab5f06e711a283343f1ada0c3
       printf '{"$schema":"https://opencode.ai/config.json","autoupdate":false,"share":"disabled","plugin":["%s"]}\n' "$src/superpowers" > "$HOME/.config/opencode/opencode.json" ;;
    S) npm i -g --prefix "$HOME/.local" @fission-ai/openspec@1.14.1
       printf '{"$schema":"https://opencode.ai/config.json","autoupdate":false,"share":"disabled","plugin":["superpowers@git+https://github.com/obra/superpowers.git#v6.1.1"]}\n' > "$HOME/.config/opencode/opencode.json"
       (cd /tmp && command opencode debug skill > /dev/null)   # OpenCode installs the plugin into its cache now, not at run time
       npm i -g --prefix "$HOME/.local" @moyaspace/openspec-superpowers-opencode@1.1.1
       (cd "$t" && oso init . --lang en > /dev/null) ;;
    T) addy "$t/.opencode/skills"
       # The project AGENTS.md template from docs/opencode-setup.md at 0.6.13.
       sed -n '/^```markdown$/,/^```$/p' "$src/agent-skills/docs/opencode-setup.md" | sed '1d;$d' > "$t/AGENTS.md"
       grep -q '^# Agent Skills (OpenCode)' "$t/AGENTS.md" ;;
    U) openspec_project
       addy "$t/.opencode/skills" spec-driven-development planning-and-task-breakdown incremental-implementation using-agent-skills idea-refine interview-me
       cp /opt/bench/opencode-addy-openspec.AGENTS.md "$t/AGENTS.md" ;;
    Z|AA) [ "$1" = Z ] || openspec_project
       clone mattpocock/skills v1.3.1 && mkdir -p "$t/.opencode/skills"
       for d in $(grep -o '"./skills/[^"]*"' "$src/mattpocock-skills/.claude-plugin/plugin.json" | tr -d '"'); do cp -r "$src/mattpocock-skills/$d" "$t/.opencode/skills/"; done
       mp_setup AGENTS.md ;;
  esac
}

case $arm in
  A) fw=none bk=no pt=no spec=none ;;          B) fw=none bk=no pt=yes spec=none ;;
  F) fw=as bk=no pt=no spec=none ;;            G) fw=sp bk=no pt=no spec=none ;;            H) fw=ecc bk=no pt=no spec=none ;;
  I) fw=as bk=no pt=no spec=openspec ;;        J) fw=sp bk=no pt=no spec=openspec ;;        K) fw=ecc bk=no pt=no spec=openspec ;;
  L) fw=as bk=yes pt=yes spec=none ;;          M) fw=sp bk=yes pt=yes spec=none ;;          N) fw=ecc bk=yes pt=yes spec=none ;;
  C) fw=as bk=yes pt=yes spec=openspec ;;      D) fw=sp bk=yes pt=yes spec=openspec ;;      E) fw=ecc bk=yes pt=yes spec=openspec ;;
  O) fw=none bk=no pt=yes spec=openspec ;;     P) fw=none bk=no pt=yes spec=speckit ;;
  AB) fw=none bk=no pt=no spec=openspec ;;     AC) fw=none bk=no pt=no spec=speckit ;;
  V) fw=mp bk=no pt=no spec=none ;;            W) fw=mp bk=no pt=no spec=openspec ;;
  X) fw=mp bk=yes pt=yes spec=none ;;          Y) fw=mp bk=yes pt=yes spec=openspec ;;
  Q|R|S|T|U|Z|AA) opencode_arm "$arm"; exit 0 ;;
  *) echo "unknown arm $arm" >&2; exit 1 ;;
esac
src=$HOME/.bench-src
clone() { git -c advice.detachedHead=false clone -q --depth 1 --branch "$2" "https://github.com/$1.git" "$src/$(echo "$1" | tr / -)"; }
plugin() { clone "$1" "$2"; claude plugin marketplace add "$src/$(echo "$1" | tr / -)"; claude plugin install "$3"; }
mkdir -p "$src" "$HOME/.claude/rules" "$HOME/.claude/skills"
# Every arm: a no-op status line, as on the owner's machine; without one Ponytail asks the agent to set one up.
printf '{"statusLine":{"type":"command","command":"true"}}\n' > "$HOME/.claude/settings.json"
git config --global user.name agent && git config --global user.email agent@localhost && git config --global init.defaultBranch main

case $fw in
  as) plugin addyosmani/agent-skills 0.6.13 agent-skills@addy-agent-skills ;;
  sp) plugin obra/superpowers v7.0.0 superpowers@superpowers-dev ;;
  ecc) DO_NOT_TRACK=1 npx -y ecc-universal@2.2.3 install --profile minimal --target claude ;;
  mp) plugin mattpocock/skills v1.3.1 mattpocock-skills@mattpocock ;;
esac
if [ "$pt" = yes ]; then
  plugin DietrichGebert/ponytail v5.2.0 ponytail@ponytail
  mkdir -p "$HOME/.config/ponytail" && printf '{"defaultMode":"full"}\n' > "$HOME/.config/ponytail/config.json"
fi

t=$HOME/project-template
if [ "$bk" = yes ]; then
  case $fw in as) rules=global.md ;; sp) rules=superpowers.rules.md ;; ecc) rules=ecc.rules.md ;; mp) rules=mattpocock.rules.md ;; esac
  cp "/opt/bench/$rules" "$HOME/.claude/rules/00-global.md"
  cp /opt/bench/candidate.rules.md "$HOME/.claude/rules/01-candidate.md"
  clone vercel-labs/skills v1.7.2 && cp -r "$src/vercel-labs-skills/skills/find-skills" "$HOME/.claude/skills/"
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
if [ "$fw" = mp ]; then mkdir -p "$t" && mp_setup; fi
