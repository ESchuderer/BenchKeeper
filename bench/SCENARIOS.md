# Benchmark scenarios

> The run machinery and raw run data described here (briefs, scorer, arm definitions, run scripts, transcripts, app archives, screenshots) were removed in [#256](https://github.com/ESchuderer/BenchKeeper/issues/256) and are no longer in the working tree. Paths below name files of the last release that had them, setup-v6.8, until the history purge of #256 removes them from the repository. The written results stay in `bench/results`, except the benches before `mistreevous` (the winery-react, cartridges and first brownfield runs) and the OpenCode arms, whose data and reports were removed in [#266](https://github.com/ESchuderer/BenchKeeper/issues/266).

Comparison matrix of the arms in `bench/PROTOCOL.md`. Every arm gets the same brief, hidden tests, scorer, app review, timeout and follow-up rule. Images are built by `bench/image/Containerfile` and `bench/image/install-arm.sh`, and each trial runs in its own container with only its arm's components.

## Claude Code arms (Claude Code 2.1.299, subscription)

| Arm | Skill framework | Ponytail | BenchKeeper layer | Spec tool | Workflow owner |
|---|---|---|---|---|---|
| A | none | no | no | none | the model |
| B | none | yes | no | none | the model, Ponytail's coding rules |
| F | agent-skills 0.6.13 (plugin) | no | no | none | agent-skills |
| G | Superpowers v7.0.0 (plugin) | no | no | none | Superpowers |
| H | ECC v2.2.3 `minimal` | no | no | none | ECC (its rules, agents, skills) |
| I | agent-skills | no | no | OpenSpec 1.14.1 | agent-skills, OpenSpec available |
| J | Superpowers | no | no | OpenSpec | Superpowers, OpenSpec available |
| K | ECC | no | no | OpenSpec | ECC, OpenSpec available |
| L | agent-skills | yes | yes | none | BenchKeeper rules, phases mapped to agent-skills |
| M | Superpowers | yes | yes | none | BenchKeeper rules, phases mapped to Superpowers |
| N | ECC | yes | yes | none | BenchKeeper rules, phases mapped to ECC |
| C | agent-skills | yes | yes | OpenSpec | the recommended setup until setup-v2.9: agent-skills phases, OpenSpec specs |
| D | Superpowers | yes | yes | OpenSpec | Superpowers phases, OpenSpec specs |
| E | ECC | yes | yes | OpenSpec | ECC phases, OpenSpec specs |
| O | none | yes | no | OpenSpec | OpenSpec |
| P | none | yes | no | Spec Kit v1.2.0 | Spec Kit |
| V | Matt Pocock's skills v1.3.1 (plugin) | no | no | none | Matt Pocock's skills |
| W | Matt Pocock's skills | no | no | OpenSpec | Matt Pocock's skills, OpenSpec available |
| X | Matt Pocock's skills | yes | yes | none | BenchKeeper rules, phases mapped to Matt Pocock's skills |
| Y | Matt Pocock's skills | yes | yes | OpenSpec | Matt Pocock's skills phases, OpenSpec specs |
| AB | none | no | no | OpenSpec | OpenSpec |
| AC | none | no | no | Spec Kit | Spec Kit |
| AD | Matt Pocock's skills | yes | v3 | none | BenchKeeper rules and `following-dev-workflow` (setup-v2.9), phases mapped to Matt Pocock's skills |
| AE | Matt Pocock's skills | yes | v3 | OpenSpec | as AD, OpenSpec owns spec and plan, Matt Pocock's execution skills |
| AF | Matt Pocock's skills | yes | no | none | Matt Pocock's skills with Ponytail, no BenchKeeper layer |
| AG | Matt Pocock's skills | yes | v4 | none | the recommended setup of setup-v3.1: its rules, `following-dev-workflow` and setup skills (`bench/arms/bk-v4/`) |
| AH | Matt Pocock's skills | yes | v5 | none | setup-v3.3: Matt Pocock's own install and setup, with the BenchKeeper rules, `following-dev-workflow` and Ponytail on top (`bench/arms/bk-v5/`) |
| AL | Matt Pocock's skills | yes | v6 | none | setup-v4.0: the BenchKeeper plugin and rules with Matt Pocock's and Ponytail's plugins, as `setup.sh` installs them (`bench/arms/bk-v6/`) |
| AM | Matt Pocock's skills | yes | v7 | none | setup-v5.0 with the Opus advisor, high effort and Sonnet subagents (`bench/arms/bk-v7/`) |
| AN | Matt Pocock's skills | no | v6 | none | AL without Ponytail |
| AO | Matt Pocock's skills | yes | v8 | none | setup-v5.3 plugin, rules and library, settings as AM (`bench/arms/bk-v8/`) |

BenchKeeper layer: rules (agent-skills: `bench/arms/bk-rules.md`, the pinned copy of `rules/global.md` of 2026-10-14, before the first setup tag; Superpowers, ECC, Matt Pocock's skills: `bench/arms/superpowers.rules.md`, `ecc.rules.md`, `mattpocock.rules.md`), candidate rules, Ponytail v5.2.0 `full`, find-skills, BenchKeeper skills, Playwright MCP 0.0.83 with Chromium, and the project `/project-setup` leaves. Layer v3 (AD, AE): the rules and `following-dev-workflow` of setup-v2.9 (`bench/arms/bk-v3*`) instead of the pinned rules, candidate rules and old setup skills. Layer v4 (AG): the rules, `following-dev-workflow` and setup skills of setup-v3.1 (`bench/arms/bk-v4/`). Layer v5 (AH): the same of setup-v3.3 (`bench/arms/bk-v5/`). Layer v6 (AL): setup-v4.0 (`bench/arms/bk-v6/`): its rules file, the BenchKeeper plugin, find-skills and its Claude settings without `advisorModel` and `remoteControlAtStartup`; no candidate rules, no Playwright MCP.

## Briefs

Each brief has its section in `bench/PROTOCOL.md`. The app briefs run through the same arms and images.

- `winery-iterative`: a React winery app plus four change requests as follow-up turns.
- `mistreevous`: brownfield, three steps in separate sessions on mistreevous: snapshot and restore of a behaviour tree's execution state (its open issue #120).
- `skill-*`: seven targeted tasks, one per phase, for the per-skill ratings.

## Failure classes

A trial is reported in exactly one class:
- installation failure: the image does not build, or the delivery audit fails (wrong or missing components);
- execution failure: the agent run errors, times out, or stops on a usage limit, overload or authentication error (infrastructure error: rerun once, then excluded);
- task-quality failure: the run finishes and the scorer reports missing features, a build or start failure, accessibility or Lighthouse findings.

## Future dimensions (not part of this benchmark)

- Context7: MCP-based retrieval of current library and framework documentation. It could be evaluated as an add-on across the relevant scenarios, holding everything else equal.
- RTK: tool-output and token optimization. It could be evaluated the same way, for its effect on tokens, cost and quality.

Neither is installed, configured or enabled in any arm.
