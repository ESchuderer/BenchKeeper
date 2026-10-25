// Writes the current app version into the install commands of the docs: `npx benchkeeper@<version>` and the clone
// tag `--branch setup-v<major>.<minor>`. Other version mentions (benchmark arms, history) stay as written.
// Usage: node .github/scripts/version-pins.mjs [--check]   (--check: exit 1 when a file differs)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// Recorded history and benchmark arms keep the versions they name.
const SKIP = /^(evaluations\/|EVALUATIONS\.md|CHANGELOG\.md|app\/test\/)|package-lock\.json$/;

export function pins(text, version) {
  const [major, minor] = version.split('.');
  return text
    .replace(/npx benchkeeper@\d+\.\d+\.\d+/g, `npx benchkeeper@${version}`)
    .replace(/--branch setup-v\d+\.\d+/g, `--branch setup-v${major}.${minor}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
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
  if (process.argv[2] === '--check' && stale.length) {
    console.log(`::error::install commands name another version than app/package.json (${version}) in ${stale.join(', ')}: run node .github/scripts/version-pins.mjs`);
    process.exit(1);
  }
}
