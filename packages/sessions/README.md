# @cedarloom/sessions

Reads every agent session of this machine from the agent tools' own session logs (Claude Code's transcripts so far), on demand: its project, agent time, tokens, cost and the result of its last test run, for the sessions board. It keeps no copy beyond a cache it can rebuild and sends nothing anywhere.

| Log                    | Where                                                       | What counts                                                                                                                                                                                                                                               |
| ---------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code transcript | `projects/<folder>/<session>.jsonl` in the Claude Code home | The last `cost-state` line: Claude Code's own cost, API plus tool time and tokens per model. Without one yet (a session still running), each message's usage once and no cost. A subagent's transcript is not read: the session's `cost-state` covers it. |

- Tests: the last test run a session made (`npm test`, `pnpm --filter x run test`, `pytest`, `go test` and the like, found by tokenizing the command with `shell-quote`). Its exit code counts when the run is the command's last step; piped on (`npm test 2>&1 | tail`) or followed by another command, the runner's summary line in the output counts (`2 failed`, `11 passed`), else the result is unknown.
- Project: the main worktree of the repository the session's folder is in, read from the `.git` entries without running git, else the folder.
- Cache: one JSON file of summaries (no message text but the session title) for the logs that still exist, re-read when a log's size or modification time changes. Deleting it loses only the project of a session whose worktree is gone since: that one then counts under its folder.
- Format: Claude Code's transcript format is undocumented; the fixtures are two recorded sessions (Claude Code 2.1.316), scrubbed.
