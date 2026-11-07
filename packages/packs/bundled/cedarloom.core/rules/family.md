## Before you push

- Run the checks of the changed files before every push; never commit or push with `--no-verify`.
- Wait for CI with `gh run watch <run-id> --compact --exit-status` or `gh pr checks --watch`, never by polling.
- `main` stays releasable: a red `main` is fixed before anything else merges.

## Code

- Reuse before reimplementing: extend or generalize what exists instead of building a parallel version.
- A well-maintained open-source package beats own code when it has recent releases, a license the project's license allow-list accepts and a size that fits; name it and the reason in the pull request. A few lines of our own still beat a new dependency.
- Comment only where the code cannot say it: one line, the why.
- No file or folder named `utils`, `helpers`, `common`, `misc` or `shared`.
- UI follows the project's styleguide and design tokens.
- When this file lists first-class targets, every change considers them; read the footgun docs it links before changing their area.
