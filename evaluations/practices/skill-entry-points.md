# Skill entry points: wrapper skills and who invokes each

Category: practices, Checked 2026-10-26, Decision: Keep all six skills as they are, no wrapper skills

Question ([#303](https://github.com/ESchuderer/BenchKeeper/issues/303)): does the plugin gain thin entry-point skills (frontmatter plus a one-line body that calls the Skill tool with a shared skill's name), or do its skills keep their whole bodies? Spike: nothing under `plugins/` or `app/` changed.

## Advertised

What each agent's documentation says about who invokes a skill and about skill-to-skill calls. "Silent" means the page was read and does not say; it is not a statement that the agent lacks the feature.

| | Claude Code | Codex | Gemini CLI | GitHub Copilot CLI |
|---|---|---|---|---|
| User starts a skill | `/name`, plugin skills as `/plugin:name` | `$name` or `/skills` | silent (only `/skills list\|link\|disable\|enable\|reload`) | name in the prompt after a slash, `/name` |
| Model starts a skill | automatic by description, through the `Skill` tool | automatic by description | `activate_skill` tool, with a confirmation prompt | automatic by prompt and description |
| User-only control | `disable-model-invocation: true` | `policy.allow_implicit_invocation: false` in `agents/openai.yaml` | none documented | none documented |
| Model-only control | `user-invocable: false` (hidden from `/`) | none documented | none documented | none documented |
| Skill calls skill | silent (the `Skill` tool exists, no page says a skill may call it) | silent | silent | silent |
| Listing budget | 1% of the context window, each entry capped at 1,536 characters | 2% of the context window, or 8,000 characters when unknown | silent | silent |

Sources, all read on 2026-10-26:

- Claude Code: [skills](https://code.claude.com/docs/en/skills) ("Claude can't invoke the skill on its own" for `disable-model-invocation: true`; `user-invocable: false` "hides it from the `/` menu"; the troubleshooting section on cut-short descriptions), [tools reference](https://code.claude.com/docs/en/tools-reference) (skills "run through the existing `Skill` tool", permission rule `Skill(name)`).
- Codex: [skills](https://developers.openai.com/codex/skills), which redirects to `learn.chatgpt.com/docs/build-skills` ("`$` to mention a skill"; with `allow_implicit_invocation: false`, "Codex won't implicitly invoke the skill based on user prompt; explicit `$skill` invocation still works", and the default is `true`).
- Gemini CLI: [skills](https://geminicli.com/docs/cli/skills/).
- Copilot CLI: [add skills](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills) ("include the skill name in your prompt, preceded by a forward slash"). The frontmatter fields `disable-model-invocation` and `user-invocable` are not mentioned on that page or on [about agent skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills).

Consequence for BenchKeeper: a user-only skill is documented in two agents. In Gemini CLI and Copilot CLI, `disable-model-invocation` has no documented effect (unverified in practice: `app/src/agents.json` marks both `tested: false`), so the user-only skills may be model-reachable there already.

Inferred, not tested: a skill that is user-only in Claude Code cannot be started by another skill through the `Skill` tool, because the docs say the model cannot invoke it. The maintainer of the public skills repository below states the same rule.

## Independent evidence

The pattern from the issue, read in the public repository `mattpocock/skills` at commit `5beb35b` (2026-10-19). A single maintainer's practice and changelog, not a measurement.

- Wrappers exist and are tiny: [`grill-me`](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/productivity/grill-me/SKILL.md) (user-only, body "Call the Skill tool with "grilling"") and [`grill-with-docs`](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/grill-with-docs/SKILL.md) (user-only, body "Call the Skill tool twice, for "grilling" and "domain-modeling"").
- Why they pay there: the shared block `grilling` is model-invoked (the model may start it from its description), and three more skills call it (`triage`, `wayfinder`, `improve-codebase-architecture`). The wrappers give the user a typed entry and combine two blocks. [`implement`](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/implement/SKILL.md) is a user-only skill with its own body that calls `tdd` and `code-review`.
- The rule they hold to, in [`.agents/invocation.md`](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/.agents/invocation.md): a user-only skill "can never reach another user-only skill", and the "call the Skill tool" convention "only holds when the named skill is model-invoked". The block behind a wrapper must therefore be model-invoked.
- The cost they hit: [#878](https://github.com/mattpocock/skills/pull/878) says naming a skill in prose "does not reliably cause it to load" and standardizes on an explicit Skill tool call (the maintainer's claim, no measurement given); [#880](https://github.com/mattpocock/skills/pull/880) removes six calls to user-only skills that could never fire.

## User reports

- [anthropics/claude-code#82237](https://github.com/anthropics/claude-code/issues/82237) (closed): in Claude Code's coordinator mode, skills with `disable-model-invocation: true` are missing from the listing and `/name` answers "not installed". Reported by users of the public repository above; the mechanism is not confirmed by an official page, so treat it as unverified. It matters for user-only skills that a coordinator session must start.

## Benchmark

Not measured. No BenchKeeper run, arm or trigger eval covers wrapper skills; no wrapper was built.

## Skill authoring check

Inventory of the six skills (line counts from `plugins/benchkeeper/skills/`, version 6.20.0 for the first five; `operating-benchkeeper` added later for [#299](https://github.com/ESchuderer/BenchKeeper/issues/299)):

| Skill | Started by | Model may start it | Reaches other skills | Reached by | Size |
|---|---|---|---|---|---|
| `workflow` | model (description, and the rule line `plugins/benchkeeper/rules/project.md:1`) or user (`/benchkeeper:workflow`) | yes | none; playbooks are linked files (`software.md`, `docs.md`, `full-tier.md`, `research.md`) | by name from `tier` (`tier/SKILL.md:12,16`), `maintaining-repos` (`maintaining-repos/SKILL.md:15,34`), `setting-up-projects` (`setting-up-projects/SKILL.md:99,106`), the spec template (`orchestrating-projects/spec-template.md:10`), the project rule line | 23 + 82 |
| `tier` | user (`/benchkeeper:tier <tier>`, also run by the tier band buttons: `plugins/benchkeeper/hooks/tier/register.tsx:59,78`) | no | names `workflow` in prose | the tier hook, by command name | 20 |
| `maintaining-repos` | user | no | names `workflow` in prose | nothing | 34 + 121 |
| `orchestrating-projects` | user, with project paths | no | none | nothing | 64 + 84 |
| `setting-up-projects` | user (the app starts it with `/benchkeeper:setting-up-projects` or `$benchkeeper:setting-up-projects`: `app/src/steps/project.mjs:503`) | no | names `workflow` in prose | nothing | 137 |
| `operating-benchkeeper` | model (description) or user (`/benchkeeper:operating-benchkeeper`) | yes | none | nothing | 41 |

No two entry points share a body. Every link between skills runs from a user-only skill to `workflow`, and no skill calls another through the Skill tool.

Questions from the issue:

- Shared bodies between two entry points: none. The one pair the pattern fits, a user-only start and a model-invoked rule for the same content, is `workflow`, and it is already one skill: model-invoked and typeable (`/benchkeeper:workflow`).
- Cost per invocation: a wrapper adds one tool call and one skill load (the wrapper's own text stays in the context next to the block). Not measured. A split of `maintaining-repos`, `orchestrating-projects` or `setting-up-projects` needs a model-invoked block, which puts a skill with side effects (writes, merges, installs) back into the model's reach and spends listing budget. `user-invocable: false` hides a block from the menu but also keeps it from being typed; the wrapper is then its only user.
- Trigger evals: `app/src/eval.mjs:40` counts a skill as triggered when a Skill call names the target or its `SKILL.md` is read. With a wrapper, a Skill call for the wrapper's name would not count for the block's case; only the later call or read of the block does. `maintaining-repos` has no trigger cases (its former set of 6 `should: false` cases could not measure successful triggering while the skill is user-only, but could record an unexpected detector match; removed in [#469](https://github.com/ESchuderer/BenchKeeper/issues/469)); a model-invoked block would need positive cases and false-trigger cases of its own. `skill-workflow.json` holds 13 (7 positive, 6 negative). No results are recorded for any of them yet (see [skill authoring](skill-authoring.md)).
- Agents: see the table above. Skill-to-skill calls are documented for no agent. Gemini CLI and Copilot CLI get the skills as copies without the plugin prefix (`app/src/agents.mjs:30`), so a wrapper's "call the Skill tool with `benchkeeper:workflow`" would need the same rewrite, and neither agent documents a user-only flag that makes the wrapper pattern's split meaningful. The repo's own note on Codex argument passing ("the word after the skill name", `tier/SKILL.md:10`) is not covered by the Codex docs read (unverified).
- Slash menu: each wrapper is one more `/benchkeeper:` entry, and a model-invoked block is one more too unless `user-invocable: false` (Claude Code only). The first five descriptions are 120 to 485 characters, under Claude Code's 1,536 per entry; Codex shortens descriptions when its 2% budget overflows.
- Lint and library bar: `.github/scripts/skill-lint.mjs` requires `agents/openai.yaml` per skill and, for `disable-model-invocation: true`, `policy.allow_implicit_invocation: false` (lines 57 to 60), so every wrapper adds a folder, a `SKILL.md` and a YAML file; a model-invoked block needs a trigger description that passes the same authoring checks as `workflow`. Nothing in the lint blocks the pattern.

## Decision

Keep all six skills as they are. No wrapper skills. `operating-benchkeeper` is a content skill with no side effect of its own (every write it describes goes through the CLI plan and approval), so it is model-invoked and has positive trigger cases in `plugins/benchkeeper/evals/skill-operating-benchkeeper.json`; no result is recorded for them yet.

| Skill | Verdict | Reason |
|---|---|---|
| `workflow` | keep | already the model-invoked skill that a user can type; a wrapper would be the same skill behind one more hop |
| `tier` | keep | user-only state change with no shared body; the hook matches the command name `benchkeeper:tier`, so a rename or split breaks the tier band |
| `maintaining-repos` | keep | side effects stay behind a typed command; a model-invoked block would need positive trigger cases and removes that guard |
| `orchestrating-projects` | keep | same; also the coordinator must start it by name |
| `setting-up-projects` | keep | same; the app launches it by command name |
| merge any two | no | different readers and different invocation, no shared text |

Revisit when a second entry point needs the same text with a different invoker (for example a user-only `/benchkeeper:` command for one of the `workflow` playbooks plus the model-invoked rule), and only after trigger-eval results exist for the block.

What the spike did not check: any agent's behaviour in a real session (all per-agent statements come from documentation or the public repository, none from a run), the cost of the extra hop in tokens or seconds, Gemini CLI and Copilot CLI enforcement of user-only skills, and whether Codex lets a skill start another.

Follow-up issues proposed (not created, each one pull request) are listed in the pull request description.

[All evaluations](../../EVALUATIONS.md)
