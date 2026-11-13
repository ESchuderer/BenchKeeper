## Before you push

- Run the checks of the changed files before every push; never commit or push with `--no-verify`.
- Wait for CI with `gh run watch <run-id> --interval 30 --compact --exit-status` or `gh pr checks --watch --interval 30`, never by polling.
- `main` stays releasable: a red `main` is fixed before anything else merges.

## Code

- Reuse before reimplementing: extend or generalize what exists instead of building a parallel version.
- A well-maintained open-source package beats own code when it has recent releases, a license the project's license allow-list accepts and a size that fits; name it and the reason in the pull request. A few lines of our own still beat a new dependency.
- Comment only where the code cannot say it: one line, the why.
- No file or folder named `utils`, `helpers`, `common`, `misc` or `shared`.
- UI follows the project's styleguide and design tokens.
- When this file lists first-class targets, every change considers them; read the footgun docs it links before changing their area.

## Writing (docs, comments, commits, issues, pull requests, UI text)

- Write what the reader needs to use, build, change or decide. Leave out restated headings, code or labels (a tooltip that repeats its button), feature counts, recaps, offers, hedging and history unless asked. Uncertainty goes in a confidence level.
- READMEs and product pages open with one or two plain sentences on what the product does for the reader, then lists, tables or steps.
- Where an em dash would go, use a comma, colon, parentheses or two sentences. No emojis or emoticons, also inside skill templates.
- Back claims about external things (APIs, versions, prices, laws) with an official source URL, or mark them "unverified". Back claims about the codebase with file and line.
