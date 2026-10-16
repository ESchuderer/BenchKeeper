# OpenBallistics

An open database of cartridges, bullets and targets, and a website to browse their dimensions and drawings.

## Repository

- `data/`: the records as JSON: `cartridges/<family>/`, `bullets/`, `targets/`.
- `fixtures/`: reference profiles and drawings the tests compare against.
- `lib/`: shared TypeScript libraries for data, geometry and drawings.
- `site/`: the Svelte website (Vite).

## Install

Requires Node.js 24 and npm. Install the exact dependencies from the lockfile:

```sh
cd site
npm ci
```

## Develop

```sh
npm run dev
```

starts the development server with the records from `data/`. `npm run preview` serves a production build.

## Test

```sh
npm test
```

runs the Vitest suite in `lib/` and `site/` against the records and fixtures.

## Build

```sh
npm run build
```

type-checks the site and writes it to `site/dist/`. Set `PAGES_BASE` (for example `/OpenBallistics/`) when the
site is served from a subpath.

## Contributing data

To correct or add a cartridge, bullet or target, edit or add its JSON record under `data/`, keep the field names
of the neighbouring records, name the source (C.I.P. sheet, manufacturer data) in the pull request, and run
`npm test` in `site/`. Without a pull request, open an issue with the data template.

## Commits and releases

- Commits follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) (`feat:`, `fix:`,
  `docs:`, `ci:`, `chore:`).
- The version is `version` in `site/package.json`, following [Semantic Versioning](https://semver.org/).
- `CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/): every change adds a line under
  `## [Unreleased]`.
- To release: move the `Unreleased` entries under `## [x.y.z]`, run `npm version x.y.z --no-git-tag-version` in
  `site/`, commit as `chore: release x.y.z`, and push the tag `vx.y.z`. The release workflow checks that the tag
  matches the version, runs the tests and publishes a GitHub release with the changelog section.
- CI (`.github/workflows/ci.yml`) runs `npm ci`, `npm test` and `npm run build` on every pull request; pushes to
  `main` deploy the site to GitHub Pages (`.github/workflows/pages.yml`).

## License

MIT (`LICENSE`). Third-party resources: `THIRD-PARTY.md`.
