// Writes the current app version into the install commands of the docs (not the plugin's skill text): `npx benchkeeper@<version>` and the clone
// tag `--branch app-v<version>` (older pins name `setup-v`). Other version mentions (benchmark arms, history) stay as written.
// It also sets minApp in plugins/benchkeeper/content.json to that version (not under --check).
// Usage: node .github/scripts/version-pins.mjs [--check]   (--check: exit 1 when a file differs, or when the dev container's Playwright differs
// from @playwright/test in web/ or app/)
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// Dependabot raises @playwright/test in both package files but not the browser build the dev container installs.
export function playwrightDrift(dockerfile, packages) {
  // From the install command, not a comment; the whole token, so a prerelease such as 1.64.1-beta.0 counts as different.
  const image = dockerfile.match(/\bnpm i\b[^\n#]*?\bplaywright@(\S+)/)?.[1];
  return { image, drift: Object.keys(packages).filter((f) => packages[f].devDependencies?.['@playwright/test'] !== image) };
}

// Node runs the main module from its real path but leaves process.argv[1] as given (macOS /var is /private/var).
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
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
    const packages = Object.fromEntries(['web/package.json', 'app/package.json'].map((f) => [f, JSON.parse(readFileSync(`${root}/${f}`, 'utf8'))]));
    const { image, drift } = playwrightDrift(readFileSync(`${root}/.devcontainer/Dockerfile`, 'utf8'), packages);
    if (!image) {
      console.log('::error::found no playwright@<version> in .devcontainer/Dockerfile');
      process.exit(1);
    }
    if (drift.length) {
      console.log(`::error::@playwright/test in ${drift.join(', ')} differs from playwright@${image} in .devcontainer/Dockerfile: set them equal`);
      process.exit(1);
    }
  }
}
