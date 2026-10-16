// Step 1 checks of skill-ship-release, run by skill-common/run.mjs, against RELEASING.md. The commits since v1.2.0 are a
// feat, a fix and a refactor whose footer says BREAKING CHANGE, so the version is 2.0.0 (S1-version). The other checks
// take the version from package.json, so a consistent release with another version fails only S1-version.
import assert from 'node:assert/strict';

const LINKS = 'https://git.example.com/unitconv';
const CHANGES = {
  lengths: /length|\bft\b|feet|inch|met(re|er)/i,
  'option renamed': /--digits/,
  'not a number rejected': /NaN|not a number|non-numeric|numeric/i,
};
const pkg = (t) => JSON.parse(t.read('package.json'));
const git = (t, args) => t.sh(`git -c safe.directory='*' ${args}`);

export default {
  'S1-version': async (t) => ({ ok: pkg(t).version === '2.0.0', detail: pkg(t).version }),
  // The lockfile's two fields and the version the tool shows (`unitconv --version`: a literal in src/version.js or one
  // read from package.json at run time).
  'S1-sync': async (t) => {
    const v = pkg(t).version;
    const lock = JSON.parse(t.read('package-lock.json'));
    const shown = t.sh('node src/cli.js --version').out.trim();
    assert.deepEqual([lock.version, lock.packages?.['']?.version, shown], [v, v, v]);
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
    assert.ok(!lines.slice(u + 1, next).some((l) => /^[-*] /.test(l)), 'Unreleased is empty');
    // The three changes in any wording, each in an entry of the release section.
    const entries = lines.slice(next, heads[heads.indexOf(next) + 1]).filter((l) => /^[-*] /.test(l));
    for (const [what, re] of Object.entries(CHANGES)) assert.ok(entries.some((l) => re.test(l)), what);
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
