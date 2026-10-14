# Design

## Sources per row

| Change | Source |
|---|---|
| Quick for a one-sentence diff | [Claude Code best practices](https://code.claude.com/docs/en/best-practices): "If you could describe the diff in one sentence, skip the plan." |
| Refactor keeps behavior, suite unchanged | [Fowler, definition of refactoring](https://martinfowler.com/bliki/DefinitionOfRefactoring.html); OpenSpec `skip_specs` for behavior-preserving refactors ([examples](https://github.com/Fission-AI/OpenSpec/blob/9111a76/docs/examples.md)) |
| Bug: failing reproducer first | Claude Code best practices: "write a failing test that reproduces the issue, then fix it" |
| UI: screenshots, accessibility | [Playwright snapshots](https://playwright.dev/docs/test-snapshots), [Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing) |
| Dependencies: semver risk, advisories | [Renovate automerge](https://docs.renovatebot.com/key-concepts/automerge/), [Dependabot security updates](https://docs.github.com/en/code-security/dependabot/dependabot-security-updates/about-dependabot-security-updates) |
| Infrastructure as code | [terraform plan](https://developer.hashicorp.com/terraform/cli/commands/plan), [Ansible check mode](https://github.com/ansible/ansible-documentation/blob/devel/docs/docsite/rst/playbook_guide/playbooks_checkmode.rst), [kubectl diff](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_diff/), [helm lint](https://helm.sh/docs/helm/helm_lint/) |
| CI workflows | [actionlint](https://github.com/rhysd/actionlint) |
| Schema migration | [Prisma, expand and contract](https://www.prisma.io/dataguide/types/relational/expand-and-contract-pattern) |
| Production data, security | [Copilot coding agent](https://docs.github.com/en/copilot/tutorials/coding-agent/get-the-best-results): keep "Sensitive and critical" tasks; [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/) |
| Logging | [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) |
| Work beyond one session, step up when work grows | agent-skills planning (XL "break it down"), Superpowers v7 brainstorming ("step up a size"), GSD quick mode, BMAD build-a-change |
| Irreversible impact | BMAD build-a-change ("irreversible actions") |

## Measured context

Agent pull request merge rates by type (AIDev, 33,596 PRs, task labels by GPT-4.1-mini, Codex dominant): docs 84%, CI 79%, build 74%, fix 64%, performance 55% ([arXiv 2601.15195](https://arxiv.org/abs/2601.15195)). Security-related agent PRs merged at 61.50% vs 77.33% ([arXiv 2601.00477](https://arxiv.org/abs/2601.00477)). These support lighter process for docs and CI and heavier for fixes, performance and security; they do not measure the tiers.

## Token cost

The table adds about 3 KB to a rules file loaded every session; `rules/global.md` stays under the 200-line target in the Claude Code memory docs.
