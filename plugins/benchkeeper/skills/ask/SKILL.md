---
name: ask
description: "Allows terminal questions (the question tool) in this Claude Code session for a while: 30 minutes, a span, until a time, or off again."
disable-model-invocation: true
argument-hint: "[for 30m|for 2h|until HH:MM|off]"
when: "On request, while you sit at the terminal and want the agent to ask you, for example to grill a plan."
writes: "One file per Claude Code process in the plugin's data folder (ask/<process id>.json, the window's end); off deletes it."
---

# Terminal questions

By default the plugin's hook refuses the question tool, and open questions go into the issue tracker the project names, else the report. This command opens a window for them: alone for 30 minutes, `for <n>m` or `for <n>h`, `until HH:MM` (local time, the next such time), or `off` to end it early. The window ends at that time or when Claude Code quits; `/clear` and compaction keep it.

The plugin's hook has already set the window and added the mode above as context. Answer with that line alone. When no such line is there, the hook did not run: say so in one line and name `benchkeeper doctor`, which reports hooks turned off.

Codex runs no hook of this plugin, so there this command changes nothing.
