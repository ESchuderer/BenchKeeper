# Agent memory

Facts agents load at session start, changed only by pull request. `INDEX.md` is the one file every session loads; a topic in `topics/` is read when its index line applies.

## What goes in

- Facts that hold across projects and sessions: how a tool behaves, a decision and where it is recorded, a pitfall and its fix.
- Never a secret, a private path or an account address, and never an issue's state: say where the work is tracked instead.

## Entry format

- `INDEX.md`: one line per topic, `- [<title>](topics/<file>.md): <when it applies>`; at most 60 lines and 4 KB.
- `topics/<topic>.md`: one topic, at most 200 lines and 16 KB, with front matter `title`, `applies-when`, `verified` (a date), `review-by` (a date), `sources` (full URLs) and `scope`; optionally `review-by-version` as `<tool> <version>`.

## Changes and expiry

- Every change is a pull request that passes the checklist of its template.
- A topic past its `review-by` date or version is checked again or removed.
