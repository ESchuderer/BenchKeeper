# Upgrading to 7.0

The commands of the `benchkeeper` CLI follow one scheme: a noun group, then a verb (`projects plan`, `skills enable`). The old names are gone, with no alias. A call that still uses one exits with 2 and prints the help.

## Renamed commands

| Old | New |
|---|---|
| `project plan [dir]`, `project apply [dir]` | `projects plan [dir]`, `projects apply [dir]` |
| `update-all [dir..]` | `projects update [dir..]` |
| `test [dir]` | `verify [dir]` |
| `board` | `sessions board` |
| `record [--project dir] -- <agent>` | `sessions record [--project dir] -- <agent>` |
| `eval` | `evals plan` (lists the targets and sessions, starts none), `evals run` (asks, then starts them) |
| `case add` | `evals cases add` |
| `maintain knowledge show`, `maintain knowledge clear` | `knowledge show`, `knowledge clear` |
| `project apply [dir] --disable <skill>` | `skills disable <name> [--project dir]` |
| `project apply [dir] --enable <skill>` | `skills enable <name> [--project dir]` |

`--json` documents carry the new name in `command`: `verify`, `projects plan`, `sessions board`, `knowledge show`.

## What stays

`ui`, `plan`, `apply`, `doctor`, `history`, `undo`, `restore`, `run`, `insights`, `profile`, `settings`, `rules`, `extensions`, `packs`, `frameworks`, `accounts`, `skills` and `projects list|add|scan|remove|rename|relocate|unshare` keep their names and options. The UI routes under `/api/` keep theirs.

Scripts and notes that call the old names need the new ones.

## Project state

`.benchkeeper/state.json` moves to `schemaVersion` 2: `appVersion` and `contentVersion` replace `setupVersion`. 7.0 reads a version 1 file with `setupVersion` as both values and writes version 2 on the next `projects apply`; a project is behind when either version differs. BenchKeeper 6.x may misread or overwrite a version 2 file, so everyone who works on a repository with a shared setup (committed state file) updates to 7.0 together.
