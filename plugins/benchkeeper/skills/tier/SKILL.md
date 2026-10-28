---
name: tier
description: "Sets the tier for the rest of this session: quick, standard, full or research, or auto to let the workflow pick again."
disable-model-invocation: true
argument-hint: "quick|standard|full|research|auto"
---

# Tier override

Tier asked for: $ARGUMENTS (Codex: the word after the skill name).

- `quick`, `standard`, `full` or `research`: every task from now on in this session runs at that tier, with that tier's steps in `benchkeeper:workflow`. Its tier line reads `Tier: <tier> (override)`.
- `auto`: the override ends, and the workflow picks each task's tier again.
- Anything else, or nothing: name the five choices and ask which one.

The override yields twice. A tier the user names for one task wins for that task. A risky change (as `workflow` defines it) still gets the full tier named and the user asked.

The override is part of this conversation, so a compaction or a resumed session can drop it; the status band (Claude Code plugin option `tierBand`) keeps it in the system prompt. After a compaction without the band, run the command again.

Answer with one line: the tier now in force for this session.
