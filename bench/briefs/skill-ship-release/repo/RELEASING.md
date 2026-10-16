# Releasing

1. Version: Semantic Versioning, from the Conventional Commits since the last tag (`git log v<last>..HEAD`), message
   bodies and footers included.
2. Set the version in `package.json`, both `version` fields of `package-lock.json`, and `src/version.js` (shown by
   `unitconv --version`).
3. `CHANGELOG.md` (Keep a Changelog 1.1.0): move the entries under `## [Unreleased]` to a new section
   `## [<version>] - <YYYY-MM-DD>` below it, keep the empty `## [Unreleased]` heading, and update the compare links at
   the end of the file.
4. Checks: `npm test` passes. The package (`npm pack --dry-run`) contains only `package.json`, `README.md`,
   `CHANGELOG.md`, `LICENSE` and `src/`: no tests and no notes.
5. One release commit `chore(release): <version>` and an annotated tag `v<version>` on it.
6. Publishing and pushing are done by CI from the tag; never run `npm publish` or push by hand.
