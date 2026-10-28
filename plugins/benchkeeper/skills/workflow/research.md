# Research

- No branch and no repository edits. Notes go to a scratch directory outside the repository unless the user asks for them in it.
- Two or more independent items: one subagent per item in parallel (Claude Code: `model: "sonnet"`), each researching directly without further subagents, then one merged answer.
- Every external claim carries an official source URL or the mark "unverified". Debated or uncertain topics get a confidence level and name what is disputed.
- Benchmarks and evaluations: independent or vendor-run, version, harness, model and effort, task count, runs per arm, deltas next to the spread, advertised claims next to measured ones.
- A question that needs running code: a throwaway spike in the scratch directory (`mattpocock-skills:prototype` when installed).
- Subagent brief: the question in one sentence, what is already known, the sources to trust, the return format (answer, source URL per claim, confidence), and the scope limit (read-only, no further subagents).
