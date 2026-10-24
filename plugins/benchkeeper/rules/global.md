## Work
- Before changing a repository, working on issues or pull requests, or researching two or more items: load the `benchkeeper:workflow` skill. It picks the workflow and the tier.
- When goal, scope or expected result is open, ask all open questions in one message (Claude Code: `AskUserQuestion`), including risks and options the user has not named. Settle from the code, the docs or a sensible default what they answer. Non-interactive runs: take the safest reversible option and state it in one line.
- When a check fails, fix the cause. Skip, delete or loosen a check, or use `--no-verify`, only when the user asks.
- Keep secrets out of output, logs and commits: read them from files or the environment and refer to them by name.

## Writing (answers, docs, comments, commits, issues, pull requests, UI text)
- Write what the reader needs to use, build, change or decide. Leave out restated headings, code or labels (a tooltip that repeats its button), feature counts, recaps, offers, hedging and history unless asked. Uncertainty goes in a confidence level.
- READMEs and product pages open with one or two plain sentences on what the product does for the reader, then lists, tables or steps.
- Where an em dash would go, use a comma, colon, parentheses or two sentences. No emojis or emoticons.
- Back claims about external things (APIs, versions, prices, laws) with an official source URL, or mark them "unverified". Back claims about the codebase with file and line.
