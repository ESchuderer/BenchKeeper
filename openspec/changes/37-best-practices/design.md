# Design

## Do we need a skill router?

No separate router. Claude Code already routes skills: "skill descriptions are loaded into context so Claude knows what's available, but full skill content only loads when invoked" (https://code.claude.com/docs/en/skills). The risk is undertriggering: Ponytail activated itself in 0 of 10 sessions without its hook (JetBrains, https://blog.jetbrains.com/ai/2026/07/ponytail-skill-claude-tested/), and in Vercel's evals an explicit instruction to use a skill raised the pass rate from 53% to 79%, a passive index in the always-on file to 100% (vendor-run, https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals).

So the router is one trigger in the always-on core: load `sdlc` before any edit in a repository and before research with two or more independent items; plain questions load nothing. `sdlc` then picks quick, standard, full or research from its table. Quick changes load it too, because branch naming, the draft pull request and its checks apply to them; the skill costs about 1,900 tokens. The core also keeps the hard limits that must hold even if the skill never loads: no commits, pushes or merges on the default branch without the user's instruction, and confirmation before destructive actions.

## Layout

| Content | Where | Loaded |
|---|---|---|
| Ask, brevity, structure, sources, confidence, forbidden characters, scope, environment, safety, context, compaction | `rules/global.md` | every session (Claude Code, Codex) |
| Tiers, change types, issue/branch/PR flow, SDLC phases, OpenSpec, research flow | `skills/sdlc/SKILL.md` | on demand (model), or `/sdlc` |
| Maintain pass, `/doctor prompt-audit`, `/skill-doctor` | `skills/maintain/SKILL.md` | `/maintain` only |
| Skipping git hooks; force push, branch deletion, push to `main`, hard reset, `git clean`, rebase, history rewrite, merge | permission rules (deny, ask) in `global-setup` part 11 | every Bash call (Claude Code) |
| Em dashes, emojis, commits on the default branch | prose in the core | every session |

## Why permission rules and no hooks

The owner prefers no hooks where they can be avoided (they run scripts on every tool call). Native permission rules cover the destructive git and gh actions: "Deny rules block in every mode, including `bypassPermissions`", and an explicit ask rule prompts "even in `auto` mode" (https://code.claude.com/docs/en/permission-modes). Bash rules match the whole command text with `*` wildcards and apply to every subcommand of a compound command (https://code.claude.com/docs/en/permissions); `git *` also covers global options such as `git -C <path>`. What a rule cannot see (the current branch, the characters in written text) stays a prose rule. The patterns were checked by running each command through headless Claude Code in `dontAsk` mode in a throwaway repository.

## Codex

Codex reads `~/.codex/AGENTS.md` (a copy of the core) and the linked skills; Claude Code permission rules do not apply to it, so the prose rules stay in the core.

## Risks

- The model may not load `sdlc` when it should: the core names the trigger explicitly; the skills benchmark (#36) measures trigger accuracy.
- Ask rules prompt even in auto mode (https://code.claude.com/docs/en/permission-modes); that is the intent for these actions.
