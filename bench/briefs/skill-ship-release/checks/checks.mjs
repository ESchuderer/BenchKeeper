// Step 1 checks of skill-ship-release, run by skill-common/run.mjs, against RELEASING.md. The commits since v1.2.0 are a
// feat, a fix and a refactor whose footer says BREAKING CHANGE, so the version is 2.0.0 (S1-version). The other checks
// take the version from package.json, so a consistent release with another version fails only S1-version.
import assert from 'node:assert/strict';

const LINKS = 'https://github.com/example/unitconv';
const pkg = (t) => JSON.parse(t.read('package.json'));
const git = (t, args) => t.sh(`git -c safe.directory='*' ${args}`);

export default {
  'S1-version': async (t) => ({ ok: pkg(t).version === '2.0.0', detail: pkg(t).version }),
  'S1-sync': async (t) => {
    const v = pkg(t).version;
    const lock = JSON.parse(t.read('package-lock.json'));
    const src = /VERSION = ['"]([^'"]+)['"]/.exec(t.read('src/version.js') ?? '')?.[1];
    assert.deepEqual([lock.version, lock.packages?.['']?.version, src], [v, v, v]);
    return true;
  },
  'S1-changelog': async (t) => {
    const v = pkg(t).version;
    const lines = (t.read('CHANGELOG.md') ?? '').split('\n');
    const heads = lines.flatMap((l, i) => (l.startsWith('## ') ? [i] : []));
    const u = heads.find((i) => lines[i] === '## [Unreleased]');
    assert.ok(u !== undefined, 'Unreleased heading');
    const next = heads[heads.indexOf(u) + 1];
    assert.match(lines[next], new RegExp(`^## \\[${v.replaceAll('.', '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}$`), 'release heading below Unreleased');
    assert.ok(!lines.slice(u + 1, next).some((l) => l.startsWith('- ')), 'Unreleased is empty');
    const section = lines.slice(next, heads[heads.indexOf(next) + 1]).join('\n');
    for (const e of ['- Lengths', '- The command line option `--precision`', '- A value that is not a number']) assert.ok(section.includes(e), e);
    assert.ok(lines.includes(`[Unreleased]: ${LINKS}/compare/v${v}...HEAD`), 'Unreleased link');
    assert.ok(lines.includes(`[${v}]: ${LINKS}/compare/v1.2.0...v${v}`), 'release link');
    return true;
  },
  'S1-package': async (t) => {
    const r = t.sh('npm pack --dry-run --json --ignore-scripts 2>/dev/null');
    const files = JSON.parse(r.out)[0].files.map((f) => f.path);
    const extra = files.filter((f) => !['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE'].includes(f) && !f.startsWith('src/'));
    assert.deepEqual(extra, [], 'files outside the list');
    assert.ok(files.includes('src/index.js') && files.includes('src/cli.js'), 'src/ packed');
    return true;
  },
  'S1-tag': async (t) => {
    const v = pkg(t).version;
    assert.equal(git(t, `cat-file -t v${v}`).out.trim(), 'tag', `annotated tag v${v}`);
    assert.equal(git(t, `log -1 --format=%s v${v}^{commit}`).out.trim(), `chore(release): ${v}`, 'release commit');
    assert.equal(JSON.parse(git(t, `show v${v}^{commit}:package.json`).out).version, v, 'version at the tag');
    return true;
  },
};
