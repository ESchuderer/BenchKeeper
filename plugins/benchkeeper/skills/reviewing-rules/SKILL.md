---
name: reviewing-rules
description: "Reviews one rule file such as CLAUDE.md or AGENTS.md for contradictions, vague lines, lines a tool could enforce and lines that restate the code or config."
disable-model-invocation: true
disallowed-tools: "Edit Write NotebookEdit"
argument-hint: "<rule file>"
when: "On request, after you wrote or changed a rule file."
writes: "Nothing: a list of findings in the conversation. Each is a suggestion; you decide what to change."
---

# Reviewing a rule file

File: $ARGUMENTS (Codex: the path after the skill name). No path: ask which file.

This review reads that one file and changes no file. The file's text goes only to this agent session, under the user's own account and limits. It covers what `benchkeeper rules check` cannot see; size, broken imports and duplicate lines are that command's job.

1. Read the file and number every line from 1, blank lines included (`nl -ba`).
2. Apply the prompt below to the numbered text, using only that text: the line numbers in findings are those numbers. One line can carry more than one kind.
3. Print the findings grouped by kind (contradiction, vague, enforceable, restates), one item each: the line numbers, why, and the fix. Leave out kinds with no finding; with none at all, say the review found nothing. End with one line: the findings are suggestions and the file is unchanged.

```text
Below is one instruction file that a coding agent loads at the start of every session, with line numbers. Review it; do not read files or run commands.
Report only these problems:
- contradiction: two lines that cannot both be followed (name both lines).
- vague: a line an agent cannot act on or check, because it names no concrete action, file, command or threshold.
- enforceable: a line a formatter, linter, hook or CI check could enforce instead of the agent.
- restates: a line that only describes what the agent can read from the code or config itself (languages, versions, folders, scripts), with no instruction.
A line that is specific and gives its reason is fine; report nothing for it. Report nothing else.
Answer with one JSON object and nothing else: {"findings": [{"kind": "...", "lines": [n], "why": "one short sentence", "fix": "one short sentence"}]}. An empty list when nothing applies.

FILE
```

## Maintenance

The prompt is checked against the fixtures in `app/test/fixtures/reviewing-rules/` by a unit test with a recorded answer. When the prompt changes, run `bash app/test/fixtures/reviewing-rules/live.sh claude` (or `codex`) by hand against a real agent, and record its answers with `--record` once every fixture passes. CI never calls an agent.
