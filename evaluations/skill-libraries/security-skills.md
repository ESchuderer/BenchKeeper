# Security skills (Sentry, Trail of Bits)

[Sentry repository](https://github.com/getsentry/skills), [Trail of Bits repository](https://github.com/trailofbits/skills), Category: skill libraries, Checked 2026-10-22 and 2026-10-24, Decision: Per project, security pack; `fp-check` removed (issue 151, setup-v6.10)

Four skills from two sources (`fp-check` was removed from the library on 2026-10-25, three remain): `gha-security-review` (getsentry/skills, Apache-2.0), `fp-check`, `variant-analysis` and `sharp-edges` (trailofbits/skills, CC-BY-SA-4.0). Pinned commits from `library.json`: Sentry `c93fb1e82454278a0caeb08e062a75a2e18feebb` (2026-10-13), Trail of Bits `e1f86a390d4caf28bf1c377a7d86707b2898669c` (2026-10-14).

## gha-security-review (getsentry/skills)

### Advertised

- Vendor: Sentry. Exploitation-focused review of `.github/workflows/`: pwn requests, expression injection, credential theft, supply chain. Every finding needs a concrete exploit scenario, only HIGH and MEDIUM confidence are reported, and "if no checks produced a finding, report zero findings" ([SKILL.md](https://github.com/getsentry/skills/blob/c93fb1e82454278a0caeb08e062a75a2e18feebb/skills/gha-security-review/SKILL.md)). No performance figure. Attack patterns come from a StepSecurity analysis of the HackerBot Claw campaign ([StepSecurity](https://www.stepsecurity.io/blog/hackerbot-claw-github-actions-exploitation)).

### Independent evidence

- None found. No benchmark, no task-level evaluation, no comparison with plain Claude Code or with workflow linters (zizmor, actionlint).

### User reports

- 4.8K installs, first seen 2026-03-03 ([skills.sh](https://skills.sh/getsentry/skills/gha-security-review)). Scans on skills.sh, all dated 2026-09-30: Snyk pass, Socket warn, Gen Agent Trust Hub fail (risk level critical).
- Both findings are triggered by the reference files' attack examples, not by instructions to the agent. [Gen Agent Trust Hub](https://skills.sh/getsentry/skills/gha-security-review/security/agent-trust-hub) lists `curl | bash` payloads, `attacker.com` and `hackmoltrepeat.com` placeholders, base64 and `${IFS}` obfuscation and runner credential theft, and itself says they "are documented as attack patterns for security auditors". [Socket](https://skills.sh/getsentry/skills/gha-security-review/security/socket) flags two MEDIUM alerts on the workflow snippets in `references/comment-triggered-commands.md` and `references/ai-prompt-injection-via-ci.md`, which it describes as "descriptive". A grep of the pinned files shows the payloads sit in `references/` only, none in `SKILL.md`.
- GitHub issues: 31 open in the repository, none found for this skill (`gh search issues`). Hacker News: no thread for the skill.

### Skill authoring check

- Apache-2.0 (repository [LICENSE](https://github.com/getsentry/skills/blob/c93fb1e82454278a0caeb08e062a75a2e18feebb/LICENSE) and [README](https://github.com/getsentry/skills/blob/c93fb1e82454278a0caeb08e062a75a2e18feebb/README.md)). `SKILL.md` has no `license` field and the skill folder has no license file. Apache-2.0 asks a redistributor to pass on the license text. A private project copy needs nothing; a public repository with the copy should carry the license file (the setup step in `setting-up-projects` already copies one next to a skill that requires attribution).
- 10 files, 192-line `SKILL.md` plus 9 reference files (76 KB), all inside the skill folder. Every reference is loaded by trigger from a table, so the agent reads only the relevant ones.
- No scripts, no downloads, no telemetry, no credential requests (grep of all files for `curl`, `wget`, `gh api`, install commands: hits only inside attack examples shown as code). No hooks. Instructions stay inside the stated purpose: read-only review. `allowed-tools: Read Grep Glob Bash Task`, so the skill may run shell commands, but it prescribes none.
- Threat model excludes anyone with write access (workflow_dispatch, protected-branch push), which keeps findings to what an external attacker can reach. It overlaps with `zizmor`-style linters; the skill adds attack-path tracing and is not a replacement for a static workflow scan (unverified: no comparison found).

### Decision

Per project, security pack: proposed when the repository has GitHub Actions workflows. The skills.sh fail is a scanner reading attack examples as instructions; the files show none addressed to the agent. Retest with a seeded-workflow brief (pwn request, expression injection, one clean workflow) before it moves into any default.

## fp-check (trailofbits/skills)

### Advertised

- Vendor: Trail of Bits, plugin author Maciej Domanski. Verifies a suspected security bug and returns TRUE POSITIVE or FALSE POSITIVE with evidence, through six gate reviews and a 13-item false-positive checklist; "not for hunting or discovering new bugs" ([SKILL.md](https://github.com/trailofbits/skills/blob/e1f86a390d4caf28bf1c377a7d86707b2898669c/plugins/fp-check/skills/fp-check/SKILL.md), [plugin README](https://github.com/trailofbits/skills/blob/e1f86a390d4caf28bf1c377a7d86707b2898669c/plugins/fp-check/README.md)). No figure for the false-positive rate it removes.

### Independent evidence

- None found. No benchmark, no eval suite in the plugin (the repository's only eval folder among the three skills belongs to `variant-analysis`).
- Context only: the skill answers LLM bias toward overrating severity with a forced checklist ("LLMs are biased toward seeing bugs and overrating severity" in SKILL.md). That is the vendor's claim, not a measurement.

### User reports

- 6.9K installs, first seen 2026-03-03, Snyk, Socket and Gen Agent Trust Hub passed ([skills.sh](https://skills.sh/trailofbits/skills/fp-check)).
- Open issues about the plugin's `Stop` and `SubagentStop` prompt hooks: they fire in every session and block the agent from stopping ([#342](https://github.com/trailofbits/skills/issues/342), [#289](https://github.com/trailofbits/skills/issues/289), [#143](https://github.com/trailofbits/skills/issues/143); closed earlier: [#205](https://github.com/trailofbits/skills/issues/205), [#131](https://github.com/trailofbits/skills/issues/131)). `hooks/hooks.json` sits outside the skill folder, so a skills CLI install copies no hooks and these issues do not apply to it. Portability checklist: [#376](https://github.com/trailofbits/skills/issues/376) lists the plugin's hooks as a Claude-specific item.

### Skill authoring check

- CC-BY-SA-4.0 ([repository LICENSE](https://github.com/trailofbits/skills/blob/e1f86a390d4caf28bf1c377a7d86707b2898669c/LICENSE)). `SKILL.md` has no `license` field and the skill folder has no license file, so the attribution must come from the install (see License and attribution below).
- 9 files (43 KB): `SKILL.md` (112 lines), 6 reference files, `agents/openai.yaml` (Codex metadata), a logo SVG. No scripts, no downloads, no telemetry, no credential requests (grep).
- Finding: files outside the skill folder. `references/deep-verification.md` delegates phases 1, 2 and 4 to three plugin agents (`data-flow-analyzer`, `exploitability-verifier`, `poc-builder`, in `plugins/fp-check/agents/`) with "using the plugin's analysis agents", and `SKILL.md` routes ambiguous, cross-component and concurrency bugs there. The skills CLI does not copy `plugins/fp-check/agents/`, so after an install the deep path has no agents to delegate to. The agent can still run the phases itself from the reference text (phase requirements are written out), but without the separate contexts and without the completeness hooks. The standard path (default: clear claim, single component, well-understood bug class) is self-contained, and it escalates to deep after step 1 or step 5 under stated conditions.
- Same class of flaw as `dimensional-analysis` ([Library exclusions](library-exclusions.md)), which was removed because its pipeline ran agent prompts from outside the folder. Difference here: the default path works, only escalation is degraded.
- `allowed-tools` names `LSP`, `TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet`, `AskUserQuestion`, `Write`, `Edit`: Claude Code tools, used by the deep path. Codex gets the standard path only (unverified how Codex treats the field).
- 20 links use the placeholder `{baseDir}/references/...`. Whether Claude Code or Codex substitutes it is unverified; the relative path still resolves from the skill folder by name.

### Decision

Removed from the library on 2026-10-25 (setup-v6.10, quality bar point 1: the deep path loses its agents on install), see [library exclusions](library-exclusions.md).

## variant-analysis (trailofbits/skills)

### Advertised

- Vendor: Trail of Bits, plugin author Axel Mierczuk. Five steps (root cause, exact match, generalize one element at a time, triage, report) with CodeQL and Semgrep templates for Python, JavaScript, Java, Go and C++ ([SKILL.md](https://github.com/trailofbits/skills/blob/e1f86a390d4caf28bf1c377a7d86707b2898669c/plugins/variant-analysis/skills/variant-analysis/SKILL.md), [README](https://github.com/trailofbits/skills/blob/e1f86a390d4caf28bf1c377a7d86707b2898669c/plugins/variant-analysis/README.md)). No figure.

### Independent evidence

- None found. Vendor-run (the plugin's own suite, not independent):
  - [evals/README.md](https://github.com/trailofbits/skills/blob/e1f86a390d4caf28bf1c377a7d86707b2898669c/plugins/variant-analysis/evals/README.md): 7 triage-panel cases, 3 runs per arm, with and without the plugin (`claude plugin eval`), Sonnet judge, candidates pasted into the prompt. Result as stated by the vendor: every case scores 1.00 without the plugin ("bare Opus 5 handles these panels unaided"), so the difference measures noise and the suite is a precision-regression guard, not an uplift measure. The skill was invoked 0 times in 40+ runs on these cases.
  - Cold run, 9 runs: with the codebase on disk the skill or workflow fired 2/3 (conversational prompt) and 3/3 (trigger language); with pasted candidates and no files, 0/3. When something fired on a real codebase, it was the workflow `/variant-analysis:variants` in 4 of 5 runs and the skill in 1 of 9.
  - [tests/README.md](https://github.com/trailofbits/skills/blob/e1f86a390d4caf28bf1c377a7d86707b2898669c/plugins/variant-analysis/tests/README.md): one seeded gradio codebase (2 injected command-injection variants, 1 decoy); pass criteria are defined, no results table in the file.
- Net: no measured uplift for the skill on any setup, and the vendor reports that the skill alone was rarely the entry point.

### User reports

- 6.3K installs, first seen 2026-01-19, Snyk, Socket and Gen Agent Trust Hub passed ([skills.sh](https://skills.sh/trailofbits/skills/variant-analysis)). No issue naming the skill in `trailofbits/skills` (`gh search issues`). It appears in the portability checklist [#376](https://github.com/trailofbits/skills/issues/376) (optional workflow, Claude plugin paths).

### Skill authoring check

- CC-BY-SA-4.0, no license file in the skill folder (see License and attribution below).
- 18 files (45 KB): `SKILL.md` (76 lines), 4 references, 5 CodeQL and 5 Semgrep templates, a report template, logo, `agents/openai.yaml`. No scripts, no downloads, no telemetry, no credential requests (grep). The templates run only when CodeQL or Semgrep is installed; the skill gives no install command.
- Finding: the Workflow section tells the agent that "this plugin ships `/variant-analysis:variants`" and to use it for large codebases. `plugins/variant-analysis/workflows/variants.js` (24.7 KB) is outside the skill folder and is not copied, so after an install the sentence points to a command that does not exist. The skill works directly (steps, references and resources are inside the folder), and the README says direct work is the path for narrow hunts. The vendor also reports the agent prefers the workflow when it exists, so an installed skill loses its most used entry point. The "When NOT to Use" lines name `audit-context-building` and `issue-writer`, which are not installed either.

### Decision

Per project, security pack, lowest confidence of the four: proposed when a found vulnerability may repeat in the code. The only vendor data shows no uplift over an unaided model on the pasted-panel cases and a rare skill entry point on a real codebase. Argument for removal: no evidence of benefit, dangling workflow reference after install. Argument for keeping: standard steps and templates are complete in the folder, no run-time risk. Retest on a codebase on disk (the gradio fixture) with and without the skill before it moves into any default.

## sharp-edges (trailofbits/skills)

### Advertised

- Vendor: Trail of Bits. Finds error-prone APIs, dangerous configurations and footgun designs ("pit of success"), through three adversaries (scoundrel, lazy developer, confused developer), six categories and language references for 12 languages ([SKILL.md](https://github.com/trailofbits/skills/blob/e1f86a390d4caf28bf1c377a7d86707b2898669c/plugins/sharp-edges/skills/sharp-edges/SKILL.md), [README](https://github.com/trailofbits/skills/blob/e1f86a390d4caf28bf1c377a7d86707b2898669c/plugins/sharp-edges/README.md)). No figure.

### Independent evidence

- None found. No eval suite, no benchmark.

### User reports

- 6.8K installs, first seen 2026-01-19, Snyk and Gen Agent Trust Hub passed, Socket warn ([skills.sh](https://skills.sh/trailofbits/skills/sharp-edges)). The [Socket alert](https://skills.sh/trailofbits/skills/sharp-edges/security/socket) (2026-09-17) is one LOW anomaly on `references/auth-patterns.md`: it describes insecure authentication design patterns, and Socket itself says the threat "arises from broken authn/authz design, not from supply-chain malware". These are the skill's examples of what to detect. No issue naming the skill in `trailofbits/skills`.

### Skill authoring check

- CC-BY-SA-4.0, no license file in the skill folder (see below).
- 19 files (131 KB): `SKILL.md` (293 lines), 16 reference files, logo, `agents/openai.yaml`. `allowed-tools: Read Grep Glob`, read-only. No scripts, no downloads, no telemetry, no credential requests, no hooks (grep). The process (four phases, report format) is written in `SKILL.md`.
- Finding, minor: the "Agent" section points to `sharp-edges-analyzer` (`plugins/sharp-edges/agents/`, outside the folder, not copied). It is an optional convenience: the same four phases are in `SKILL.md`, so nothing needed is missing.
- Size: the references total about 120 KB, loaded on demand per language or topic; `SKILL.md` is the largest of the four at 293 lines. [SkillsBench](https://arxiv.org/abs/2602.12670) (87 tasks) found focused skills ahead of exhaustive bundles; context only, not evidence for this skill.

### Decision

Per project, security pack: proposed when the repository exposes an API or configuration others can misuse. No evidence of effect; no authoring defect that breaks it.

## License and attribution (the three Trail of Bits skills)

- License: CC-BY-SA-4.0, stated in the [repository README](https://github.com/trailofbits/skills/blob/e1f86a390d4caf28bf1c377a7d86707b2898669c/README.md) ("Made by Trail of Bits") and the [LICENSE](https://github.com/trailofbits/skills/blob/e1f86a390d4caf28bf1c377a7d86707b2898669c/LICENSE) file at the repository root. The skills CLI copies the skill folder only, so the license text is not in the install.
- Obligations when the copy is shared (the [legal code](https://creativecommons.org/licenses/by-sa/4.0/legalcode.en), section 3(a)): name the creator, keep any copyright notice, give a notice that refers to the license and to its disclaimer of warranties, link to the source, mark the material as licensed under CC-BY-SA-4.0, and indicate modifications. Private use in a project not published or distributed triggers none of these.
- ShareAlike (section 3(b)) applies to Adapted Material: a modified or translated copy that is shared must carry the same or a compatible license. A verbatim copy placed in a repository next to differently licensed code is not an adaptation of that code (unverified legal reading, no legal advice); a changed `SKILL.md` that is published is an adaptation and must be CC-BY-SA-4.0 or compatible.
- What an install needs: the license text (the repository LICENSE) next to each skill folder, a line naming Trail of Bits as creator with the source URL and pinned commit, and per-plugin authors where given (Maciej Domanski for fp-check, Axel Mierczuk for variant-analysis per their plugin metadata). The `setting-up-projects` step 5 already requires a license file next to a CC-BY or CC-BY-SA skill; the attribution line is not required there, and the library note says the copy "keeps its license and attribution", which holds only when that step runs. Edits to the installed skills (for example removing the dangling workflow sentence) count as modifications to indicate.
- Sentry: Apache-2.0, license text from the repository root if the copy is redistributed; no attribution line required.

## Quality bar check (issue 151, 2026-10-24)

Pins: getsentry/skills `c93fb1e82454278a0caeb08e062a75a2e18feebb` (2026-10-13), trailofbits/skills `e1f86a390d4caf28bf1c377a7d86707b2898669c` (2026-10-14).

Grading used (the same for every source; the bar is in [library quality bar](library-quality-bar.md)): pass, borderline (soft problems only, or a reading of the bar that the owner decides) or fail (a hard limit broken). Overall is the worst point.

| Skill | 1 Runs as installed | 2 License | 3 Authoring | 4 Earns its place | 5 Maintained | Overall |
|---|---|---|---|---|---|---|
| `gha-security-review` | pass | pass | pass | pass | pass | pass |
| `fp-check` | fail | borderline | borderline | pass | pass | fail |
| `variant-analysis` | borderline | borderline | pass | borderline | pass | borderline |
| `sharp-edges` | pass | borderline | pass | pass | pass | borderline |

Measured at the pin:

| Skill | Description characters | `SKILL.md` lines | License | Effect evidence |
|---|---|---|---|---|
| `gha-security-review` | 363 | 192 | root `LICENSE` Apache-2.0 | none (maintainer PRs only); skills.sh 4.8K installs |
| `fp-check` | 343 | 112 | root `LICENSE` CC-BY-SA-4.0 only | none; open hook issues #143, #289, #342 |
| `variant-analysis` | 566 | 76 | root `LICENSE` CC-BY-SA-4.0 only | maintainer eval: no uplift over an unaided model |
| `sharp-edges` | 376 | 293 | root `LICENSE` CC-BY-SA-4.0 only | none |

Findings (every fail and borderline with file and line or URL):

- `gha-security-review`: pass.
  - Other: 10 files, all inside the folder (`SKILL.md:72-80` paths exist); `curl | bash` hits are attack samples in `references/`. Two See-also links return 404 (`references/runner-infrastructure.md:268`, `references/real-world-attacks.md:296`), not relied on. Pin is 11 days old; 10 later commits, none in the folder.
- `fp-check`: fail.
  - Point 1, fail: The deep path delegates phases to `data-flow-analyzer`, `exploitability-verifier` and `poc-builder` (`skills/fp-check/SKILL.md:82`, `references/deep-verification.md:58, 64-70`), which live in `plugins/fp-check/agents/` (405 lines) and are not copied by the skills CLI. The standard path (`SKILL.md:59-69`) is self-contained and the deep phases are written out (`deep-verification.md:74-143`), so the skill degrades instead of stopping (unlike `dimensional-analysis`). The plugin `Stop` and `SubagentStop` hooks (`hooks/hooks.json:4-27`) are outside the folder, so an install adds none. Owner call: strict reading is fail.
  - Point 2, borderline: CC-BY-SA-4.0 (share-alike) only in the repository root `LICENSE` (`LICENSE:1`, `README.md:162-164`); no license file or `license:` field in the skill or plugin folder, so an install carries no license text. Matches `library.json`.
  - Point 3, borderline: Reference files link to each other (`standard-verification.md:7, 24, 35, 55, 78`, `deep-verification.md:60, 80, 92, 112, 139, 143`); 22 `{baseDir}` placeholders (substitution unverified).
- `variant-analysis`: borderline.
  - Point 1, borderline: `SKILL.md:50-57` points to the `/variant-analysis:variants` workflow and `SKILL.md:20, 22, 23` to two other skills, none installed; nothing the skill body needs is missing. The maintainer says the workflow is the main entry for large codebases (`plugins/variant-analysis/README.md:25`).
  - Point 2, borderline: CC-BY-SA-4.0 (share-alike) only in the repository root `LICENSE` (`LICENSE:1`, `README.md:162-164`); no license file or `license:` field in the skill or plugin folder, so an install carries no license text. Matches `library.json`.
  - Point 4, borderline: Distinct trigger, no overlap. The maintainer's own suite shows every case at 1.00 without the plugin and 0 skill invocations in 40+ runs (`plugins/variant-analysis/evals/README.md:73-81`), and the skill fired 0 of 3 times without files on disk (`:86-90`). No independent evidence.
- `sharp-edges`: borderline.
  - Point 2, borderline: CC-BY-SA-4.0 (share-alike) only in the repository root `LICENSE` (`LICENSE:1`, `README.md:162-164`); no license file or `license:` field in the skill or plugin folder, so an install carries no license text. Matches `library.json`.
  - Other: Workflow inline (`SKILL.md:199-247`), 16 reference files present; the analyzer agent (`SKILL.md:25-27`) is optional and not copied.

Source notes:

- Point 5: both repositories are not archived and active (newest commits 2026-10-23). Ten commits on each since the pin, none in the four skill folders.
- License location: Apache-2.0 only in the getsentry root `LICENSE`, CC-BY-SA-4.0 only in the trailofbits root `LICENSE`; no license file or `license:` field in any skill or plugin folder. CC-BY-SA-4.0 is share-alike and not a software license, hence borderline; the Security section note in `library.json` already says the copied skill keeps its license and attribution.
- Trail of Bits issues: fp-check plugin hooks fire in unrelated sessions and block stopping ([#143](https://github.com/trailofbits/skills/issues/143), [#289](https://github.com/trailofbits/skills/issues/289), [#342](https://github.com/trailofbits/skills/issues/342), open, fix PRs [#350](https://github.com/trailofbits/skills/pull/350), [#358](https://github.com/trailofbits/skills/pull/358)); the hooks sit in `plugins/fp-check/hooks/hooks.json`, outside the skill folder. [#376](https://github.com/trailofbits/skills/issues/376) lists the plugin's Claude-specific dependencies. The maintainer moves value into plugin workflows that a folder copy lacks ([#243](https://github.com/trailofbits/skills/pull/243), [#232](https://github.com/trailofbits/skills/pull/232)).
- skills.sh (2026-10-24): `gha-security-review` 4.8K installs (Gen Agent Trust Hub fail, Socket warn, Snyk pass; the alerts come from attack samples in `references/`), `fp-check` 6.9K, `variant-analysis` 6.4K, `sharp-edges` 6.8K (Socket Warn).

Removal: `fp-check` was removed on the owner's decision in [issue 151](https://github.com/ESchuderer/BenchKeeper/issues/151) and is in [library exclusions](library-exclusions.md); the borderline skills stay.

## Decision

Security pack (setup-v6.0), per project: `gha-security-review` for repositories with workflows, `sharp-edges` for exposed APIs or configuration, `variant-analysis` for follow-up on a found vulnerability. `fp-check` (triage) was removed on 2026-10-25 because its deep verification loses its three agents on install. No independent evidence for any of the four. Open points for the owner:

- `variant-analysis`: points to a workflow that is not installed, and the only maintainer data shows no uplift over an unaided model.
- Attribution: add the license file and a creator line for the two remaining Trail of Bits skills at install, or drop them.

[All evaluations](../../EVALUATIONS.md)
