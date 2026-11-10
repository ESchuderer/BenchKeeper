// Writes the current app version into the install commands of the docs (not the plugin's skill text): `npx benchkeeper@<version>` and the clone
// tag `--branch app-v<version>` (older pins name `setup-v`). Other version mentions (benchmark arms, history) stay as written.
// With --release (release.yml, on the release branch) it also sets minApp in plugins/benchkeeper/content.json to that version.
// Usage: node .github/scripts/version-pins.mjs [--check | --release]   (--check: changes nothing; exit 1 when a file differs, or when
// the dev container's Playwright, pnpm or Node differs from web/, app/ and packages/ui, .github/pnpm, or NODE_VERSION of cedarloom.yml)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './main.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// Recorded history and benchmark arms keep the versions they name; skill text under plugins/ names the major (npx benchkeeper@6), not a pin.
export const SKIP = /^(bench\/|evaluations\/|CHANGELOG\.md|app\/test\/|plugins\/)|package-lock\.json$/;

export function pins(text, version) {
  return text
    .replace(/npx benchkeeper@\d+\.\d+\.\d+/g, `npx benchkeeper@${version}`)
    .replace(/--branch (setup|app)-v\d+\.\d+(\.\d+)?/g, `--branch app-v${version}`);
}

// The content of a release needs the app of that release: minApp follows the app version.
export function minAppPin(text, version) {
  return text.replace(/("minApp"\s*:\s*")\d+\.\d+\.\d+(")/, `$1${version}$2`);
}

// As Docker reads the file: comment lines (a whole line starting with #) dropped, then continued lines joined, so an
// install command in a comment is not what the image runs and one spread over several lines is one command.
const commands = (dockerfile) => dockerfile.replace(/^[ \t]*#.*\r?\n?/gm, '').replace(/\\\r?\n/g, ' ');

// Dependabot raises @playwright/test in each package file but not the browser build the dev container installs.
export function playwrightDrift(dockerfile, packages) {
  // From the install command, not a comment; the whole token, so a prerelease such as 1.64.1-beta.0 counts as different.
  const image = commands(dockerfile).match(/\bnpm i\b[^\n#]*?\bplaywright@(\S+)/)?.[1];
  return { image, drift: Object.keys(packages).filter((f) => packages[f].devDependencies?.['@playwright/test'] !== image) };
}

// Dependabot raises pnpm in .github/pnpm (the CedarLoom CI) but not the pnpm the dev container installs.
export function pnpmDrift(dockerfile, pinned) {
  const image = commands(dockerfile).match(/\bnpm i\b[^\n#]*?\bpnpm@(\S+)/)?.[1];
  return { image, drift: image !== pinned };
}

// Both are bumped by hand: the dev container's Node follows NODE_VERSION of cedarloom.yml, the CI of the CedarLoom packages.
export function nodeDrift(dockerfile, workflow) {
  // shortcut: reads the FROM tag, not the digest Docker runs, so a new tag with the old digest passes; check the digest if a job may go online.
  const image = commands(dockerfile).match(/^[ \t]*FROM[ \t]+docker\.io\/library\/node:([\w.]+)-/m)?.[1];
  // The version's characters only: quotes and a trailing comment end it.
  const ci = workflow.match(/^[ \t]+NODE_VERSION:[ \t]*['"]?([\w.]+)/m)?.[1];
  return { image, ci, drift: image === undefined || image !== ci };
}

if (isMain(import.meta.url)) {
  const { version } = JSON.parse(readFileSync(`${root}/app/package.json`, 'utf8'));
  const files = execFileSync('/usr/bin/git', ['ls-files', '*.md', '*.json', '*.tsx'], { cwd: root, encoding: 'utf8' }).split('\n').filter((f) => f && !SKIP.test(f));
  const stale = [];
  for (const f of files) {
    const text = readFileSync(`${root}/${f}`, 'utf8');
    const next = pins(text, version);
    if (next === text) continue;
    stale.push(f);
    if (process.argv[2] !== '--check') writeFileSync(`${root}/${f}`, next);
  }
  // The release branch only (--release from release.yml): on main the app version may move ahead of minApp
  // (app/test/package.test.mjs allows it), so neither --check nor a plain run changes it.
  if (process.argv[2] === '--release') {
    const f = `${root}/plugins/benchkeeper/content.json`;
    const text = readFileSync(f, 'utf8');
    const next = minAppPin(text, version);
    if (next !== text) writeFileSync(f, next);
  }
  if (process.argv[2] === '--check' && stale.length) {
    console.log(`::error::install commands name another version than app/package.json (${version}) in ${stale.join(', ')}: run node .github/scripts/version-pins.mjs`);
    process.exit(1);
  }
  if (process.argv[2] === '--check') {
    const manifests = ['web/package.json', 'app/package.json', 'packages/ui/package.json'];
    const packages = Object.fromEntries(manifests.map((f) => [f, JSON.parse(readFileSync(`${root}/${f}`, 'utf8'))]));
    const { image, drift } = playwrightDrift(readFileSync(`${root}/.devcontainer/Dockerfile`, 'utf8'), packages);
    if (!image) {
      console.log('::error::found no playwright@<version> in .devcontainer/Dockerfile');
      process.exit(1);
    }
    if (drift.length) {
      console.log(`::error::@playwright/test in ${drift.join(', ')} differs from playwright@${image} in .devcontainer/Dockerfile: set them equal`);
      process.exit(1);
    }
    const pinned = JSON.parse(readFileSync(`${root}/.github/pnpm/package.json`, 'utf8')).dependencies?.pnpm;
    const pnpm = pnpmDrift(readFileSync(`${root}/.devcontainer/Dockerfile`, 'utf8'), pinned);
    if (pnpm.drift) {
      console.log(`::error::pnpm@${pnpm.image} in .devcontainer/Dockerfile differs from pnpm ${pinned} in .github/pnpm/package.json: set them equal`);
      process.exit(1);
    }
    const node = nodeDrift(readFileSync(`${root}/.devcontainer/Dockerfile`, 'utf8'), readFileSync(`${root}/.github/workflows/cedarloom.yml`, 'utf8'));
    if (!node.image) {
      console.log('::error::found no FROM docker.io/library/node:<version>-<variant> in .devcontainer/Dockerfile');
      process.exit(1);
    }
    if (node.drift) {
      console.log(`::error::node:${node.image} in .devcontainer/Dockerfile differs from NODE_VERSION ${node.ci} in .github/workflows/cedarloom.yml: set them equal`);
      process.exit(1);
    }
  }
}
