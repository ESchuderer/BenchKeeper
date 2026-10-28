# Lite install: the workflow skill without an always-on rule

Category: practices, Checked 2026-10-25, Decision: Lite level in, trigger rate unverified

## Advertised

- A plugin cannot ship a rule file: a `CLAUDE.md` at the plugin root is not loaded as context, and `claude plugin validate` warns about it ("put them in a skill"). Source: [plugins reference, standard layout](https://code.claude.com/docs/en/plugins-reference). A plugin hook can add context, though: a `SessionStart` hook returns `additionalContext` (or plain stdout on exit 0), capped at 10,000 characters, and a plugin's hooks merge with the user's when it is enabled. Source: [hooks reference](https://code.claude.com/docs/en/hooks.md). BenchKeeper's plugin ships no such hook, so lite (the plugin alone) depends on the description of the `workflow` skill to start it, where full level adds a rule line that says to load it. Whether an injected line would raise the trigger rate is untested.

## Benchmark

Not measured. Trigger rate of `benchkeeper:workflow` with no rule line: unverified.

- Target: the 13 cases of `plugins/benchkeeper/evals/skill-workflow.json` (7 should trigger, 6 should not), Claude Code on Sonnet, one session per case, on the subscription.
- Why it did not run: the measurement needs headless `claude -p` sessions in a clean config folder that holds only the plugin (no rule files, no other plugins), and the account to bill them was not available to the session that built the level model. The dev container has no Claude Code and no login.
- To run it, on a scratch HOME so no rule file or other plugin is loaded:
  1. `HOME=$SCRATCH CLAUDE_CONFIG_DIR=$SCRATCH/.claude npx benchkeeper@<version> apply --level lite --agents claude --yes`
  2. Log in there with the subscription (not an API key).
  3. `HOME=$SCRATCH CLAUDE_CONFIG_DIR=$SCRATCH/.claude npx benchkeeper@<version> evals run --target skill:workflow --model sonnet --all --yes`
  4. Repeat with the rule line present (`apply --level full`, then projects apply) as the baseline; compare miss rate and false trigger rate.
- Record here: agent and model versions, cases, sessions per case, miss rate and false trigger rate for both arms. 13 cases at one session each is a signal, not a measurement (see the rules in [EVALUATIONS.md](https://github.com/ESchuderer/BenchKeeper-research/blob/main/EVALUATIONS.md#rules)).

## Decision

Lite ships as a level, `apply` plans the level found on the machine and `full` on a machine without BenchKeeper, so no default depends on this number. Until the rate is recorded, the docs say lite relies on the skill description and nothing promises it triggers.

[All evaluations](https://github.com/ESchuderer/BenchKeeper-research/blob/main/EVALUATIONS.md)
