# Rules

- Release notes come from the pull request description: never edit CHANGELOG.md by hand, release tooling rewrites it.
- Tests use a temporary home folder; never run the installer against your real home directory.
- Ask before changing a public API: other repositories import it.
