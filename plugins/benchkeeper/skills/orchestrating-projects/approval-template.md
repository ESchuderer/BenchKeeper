---
name: Approval or owner question
about: A decision the owner makes before agents act. Every approval uses this layout.
labels: question, ready-for-human
---

What: <the decision in one sentence; link the plan or report>

| Approval | |
|---|---|
| Recommended | (a) <option>, confidence <high, medium or low> |
| Work if approved | <n PRs, each under 1,000 lines, in owner/repo; order> |
| Runs on | <orchestrator model and effort>; phases: plan <model effort>, implement <model effort>, test <model effort>, review <model effort, depth> |
| Review | <fresh reviewer per PR; xhigh plus security review where it applies> |
| Merges | <who merges; parts left for the owner: workflows, Dependabot, settings, releases> |
| Owner steps | <bench, deploy, login, purchase; or none> |
| Cost | <sessions and an estimate; mark unverified> |
| Undo | <how each part is reversed> |
| Answer | <in the hub repository: run /benchkeeper:questions; in any other: comment "a", "b" or free text on this issue> |

| Option | What happens | Trade-off |
|---|---|---|
| (a) <recommended> (Recommended) | | |
| (b) | | |
| (c) Hold | Nothing changes | |

Why now: <what waits on it>
