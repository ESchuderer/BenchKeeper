# Releasing

BenchKeeper releases only when the owner merges the release pull request or starts a release workflow by hand. No workflow merges that pull request or enables auto-merge on it.

## Components

| Component | Files | Version | Tag | Changelog |
| --- | --- | --- | --- | --- |
| App | `app/` (npm package `benchkeeper`) | semver: `fix` and `perf` raise the patch, `feat` the minor version | `app-v<x.y.z>` | `app/CHANGELOG.md` |
| Content | `plugins/benchkeeper/` (rules, skills, plugin) | `<x.y>.0`: every release raises the minor version (`plugin.json` of both agents, `content.json` `contentVersion`) | `setup-v<x.y>` for the docs and the Release, `setup-v<x.y>.0` for release-please | `plugins/benchkeeper/CHANGELOG.md` |

`CHANGELOG.md` at the repository root holds the single setup version up to 6.25. A major version releases both components, because skill text names `npx benchkeeper@<major>`; it is set with `release-as` in `release-please-config.json` on the release pull request. A major release also changes the major in the skill and automation text under `plugins/` (`npx benchkeeper@<major>`, `npx -y benchkeeper@<major>`); the package test fails while any of it names the old major.

## Steps

1. Pull requests target `main`, squash-merged; the title is a Conventional Commit and becomes the changelog line (`.github/workflows/pr-title.yml`). `docs`, `refactor`, `test`, `chore` and `ci` release nothing.
2. On every push to `main`, release-please (`.github/workflows/release.yml`, `release-please-config.json`, `.release-please-manifest.json`) keeps one release pull request open with the new versions and changelogs, titled `chore(main): release benchkeeper` for both components (the title of a pull request that groups components carries no version; its body lists each component with its version). The same workflow pins the install commands in the docs to the new app version on that branch and sets `minApp` in `plugins/benchkeeper/content.json` to it, so the released content refuses an older app (`.github/scripts/version-pins.mjs`).
3. Before an app release, the owner checks the Codex price table `app/src/codex-prices.json` (the board's Codex cost estimate) against the page in its `source` field, adds every new Codex model and sets `date`. Then the owner merges the release pull request.
4. The job `release` of the Release workflow, on that merge:
   1. starts `npm.yml` when the app version changed and npm does not have it, waits for the run and checks that the registry serves the version;
   2. creates the tags and the GitHub Releases;
   3. moves the branch `stable` (the ref the app adds BenchKeeper's marketplace at) to the release commit;
   4. starts `.github/workflows/pages.yml`;
   5. labels the release pull request `autorelease: tagged`, so release-please opens the next one.

A failed publish creates no tag or Release and moves nothing. Rerun the job after the fix: each step skips what an earlier run did. Until then the docs on `main` name a version npm does not have, and release-please opens no new release pull request.

## Site

`.github/workflows/pages.yml` builds one Pages artifact on pushes to `main`, on `release: published` and by hand:

- `/BenchKeeper/`: the latest GitHub Release, built from its tag. Without a release the root redirects to `/next/`.
- `/BenchKeeper/next/`: `main` (`SITE_EDITION=next`).

Both editions share one origin, so `next` stores its color scheme under its own key (`web/src/lib/edition.ts`).

## Owner settings

- A release GitHub App (variable `RELEASE_APP_CLIENT_ID`, secret `RELEASE_APP_PRIVATE_KEY`) or a token, so checks run on the release pull request. Without it the owner approves its runs.
- The `github-pages` environment allows `main` and the release tags (`setup-v*`, `app-v*`).
- The ruleset keeps the required check names and lets the owner merge the release pull request.
- The npm trusted publisher keeps naming `npm.yml`.
