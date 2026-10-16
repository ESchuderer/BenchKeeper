// Step 1 checks (repository setup) on /ws; prints {"checks":[...]}. Run by step1.sh in the node container, which
// mounts the workspace copy at /ws, bench/scorer at /scorer (for `yaml`) and the actionlint result at /out.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { posix } from 'node:path';

const YAML = createRequire('/scorer/package.json')('yaml');
const WS = '/ws';
const read = p => (existsSync(`${WS}/${p}`) ? readFileSync(`${WS}/${p}`, 'utf8') : null);
const json = p => { try { return JSON.parse(read(p)); } catch { return null; } };
const list = v => (v == null ? [] : Array.isArray(v) ? v : [v]);
const scripts = dir => json(posix.join(dir, 'package.json'))?.scripts ?? null;

const wfDir = '.github/workflows';
const workflows = (existsSync(`${WS}/${wfDir}`) ? readdirSync(`${WS}/${wfDir}`) : [])
  .filter(f => /\.ya?ml$/.test(f)).sort()
  .map(f => {
    const text = read(`${wfDir}/${f}`);
    let doc = null;
    try { doc = YAML.parse(text); } catch {}
    return { file: f, text, doc: doc ?? {} };
  });
// `on:` as a string, a list or a map, normalized to a map of trigger to config.
const triggers = wf => {
  const on = wf.doc.on;
  return typeof on === 'string' || Array.isArray(on) ? Object.fromEntries(list(on).map(t => [t, null])) : on ?? {};
};
const jobs = wf => Object.entries(wf.doc.jobs ?? {}).filter(([, j]) => j && typeof j === 'object');
const uses = (job, re) => list(job.steps).some(s => re.test(s?.uses ?? '')) || re.test(job.uses ?? '');

// npm calls in a shell script: [{script, dir}] for `npm run x`, `npm test`, `npm start` and the like; built-in
// commands (ci, install, audit, version, ...) need no script. `cd <dir>` and `--prefix <dir>` change the directory.
const LIFECYCLE = { test: 'test', t: 'test', tst: 'test', start: 'start', stop: 'stop', restart: 'restart' };
function npmCalls(cmd, dir = '.') {
  const calls = [];
  for (const segment of String(cmd).split(/&&|\|\||[;|\n]/)) {
    const t = segment.trim().split(/\s+/);
    if (t[0] === 'cd' && t[1]) { dir = posix.normalize(posix.join(dir, t[1])); continue; }
    let i = t.indexOf('npm'), d = dir;
    if (i < 0) continue;
    for (i++; t[i]?.startsWith('-'); i++) {
      if (t[i] === '--prefix') d = posix.normalize(posix.join(dir, t[++i] ?? ''));
      else if (t[i].startsWith('--prefix=')) d = posix.normalize(posix.join(dir, t[i].slice(9)));
      else if (['-w', '--workspace'].includes(t[i])) i++;
    }
    const sub = t[i];
    if (['run', 'run-script', 'rum', 'urn'].includes(sub)) {
      const name = t.slice(i + 1).find(x => !x.startsWith('-'));
      if (name) calls.push({ script: name.replace(/[`'"]/g, ''), dir: d });
    } else if (LIFECYCLE[sub?.replace(/[`'"]/g, '')]) calls.push({ script: LIFECYCLE[sub.replace(/[`'"]/g, '')], dir: d });
  }
  return calls;
}
// Run steps of a workflow with their working directory (step, job defaults, workflow defaults).
const runs = wf => jobs(wf).flatMap(([, job]) => list(job.steps).filter(s => s?.run).map(s => ({
  cmd: s.run,
  dir: posix.normalize(s['working-directory'] ?? job.defaults?.run?.['working-directory'] ?? wf.doc.defaults?.run?.['working-directory'] ?? '.'),
})));
const wfCalls = wf => runs(wf).flatMap(r => npmCalls(r.cmd, r.dir));

const checks = [];
const check = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail });
// Each check runs on its own, so a malformed workflow fails the checks it breaks and the others still report.
const safe = (id, fn) => { try { fn(); } catch (e) { check(id, false, `check error: ${e.message}`); } };
const none = 'no workflows in .github/workflows';
const have = workflows.length > 0;

// S1-actionlint: actionlint 1.7.7 (with shellcheck) reports no error in any workflow.
safe('S1-actionlint', () => {
  const exit = existsSync('/out/actionlint.exit') ? readFileSync('/out/actionlint.exit', 'utf8').trim() : 'not run';
  const log = existsSync('/out/actionlint.txt') ? readFileSync('/out/actionlint.txt', 'utf8').trim().split('\n').slice(0, 3).join(' | ') : '';
  check('S1-actionlint', have && exit === '0', have ? `exit ${exit}${log ? `: ${log}` : ''}` : none);
});

// S1-ci-checks: a workflow triggered by pull_request runs the test and build scripts.
safe('S1-ci-checks', () => {
  const ci = workflows.filter(wf => 'pull_request' in triggers(wf) && ['test', 'build'].every(s => wfCalls(wf).some(c => c.script === s)));
  check('S1-ci-checks', ci.length > 0, ci.length ? `pull_request workflows running test and build: ${ci.map(w => w.file).join(', ')}` : 'no pull_request workflow runs both test and build');
});

// S1-npm-scripts: every npm script a run: step calls exists in the package.json of its working directory.
safe('S1-npm-scripts', () => {
  const calls = workflows.flatMap(wf => wfCalls(wf).map(c => ({ ...c, file: wf.file })));
  const missing = calls.filter(c => !(scripts(c.dir) && c.script in scripts(c.dir)));
  check('S1-npm-scripts', have && calls.length > 0 && missing.length === 0,
    !have ? none : missing.length ? `missing: ${missing.map(c => `${c.file}: ${c.dir}/package.json "${c.script}"`).join(', ')}` : `${calls.length} npm script calls, all defined`);
});

// S1-sha-pins: every uses: is a local path, a docker:// image with a digest, or owner/repo@<40-hex SHA>.
safe('S1-sha-pins', () => {
  const refs = workflows.flatMap(wf => jobs(wf).flatMap(([, job]) => [job.uses, ...list(job.steps).map(s => s?.uses)]).filter(Boolean).map(u => `${wf.file}: ${u}`));
  const bad = refs.filter(r => { const u = r.split(': ')[1]; return !(/^\.\//.test(u) || /^docker:\/\/.+@sha256:[0-9a-f]{64}$/.test(u) || /^[^@\s]+@[0-9a-f]{40}$/.test(u)); });
  check('S1-sha-pins', have && refs.length > 0 && bad.length === 0, !have ? none : bad.length ? `not pinned: ${bad.join(', ')}` : `${refs.length} uses:, all pinned`);
});

// S1-permissions: permissions: set at workflow level or on every job; no write-all; no write at workflow level; a job
// writes only what it needs: pages and id-token to deploy Pages, contents in a tag-triggered or release-please release,
// pull-requests and issues for release-please, id-token and attestations for build attestations.
safe('S1-permissions', () => {
  const bad = [];
  const writes = p => (p && typeof p === 'object' ? Object.entries(p).filter(([, v]) => v === 'write').map(([k]) => k) : []);
  for (const wf of workflows) {
    const top = wf.doc.permissions;
    if (top === 'write-all') bad.push(`${wf.file}: write-all`);
    if (writes(top).length) bad.push(`${wf.file}: workflow-level write ${writes(top).join(',')}`);
    const tags = Object.entries(triggers(wf)).every(([t, c]) => t === 'workflow_dispatch' || t === 'release' || (t === 'push' && c?.tags && !c.branches));
    for (const [name, job] of jobs(wf)) {
      if (top === undefined && job.permissions === undefined) bad.push(`${wf.file}: ${name} has no permissions`);
      if (job.permissions === 'write-all') bad.push(`${wf.file}: ${name} write-all`);
      const allowed = new Set([
        ...(uses(job, /^actions\/deploy-pages@/) ? ['pages', 'id-token'] : []),
        ...(uses(job, /release-please-action@/) ? ['contents', 'pull-requests', 'issues'] : tags ? ['contents'] : []),
        ...(uses(job, /^actions\/attest(-build-provenance)?@/) ? ['id-token', 'attestations'] : []),
      ]);
      const extra = writes(job.permissions).filter(k => !allowed.has(k));
      if (extra.length) bad.push(`${wf.file}: ${name} writes ${extra.join(',')}`);
    }
  }
  check('S1-permissions', have && bad.length === 0, !have ? none : bad.length ? bad.join('; ') : 'least permissions in every workflow');
});

// S1-no-prt: no workflow uses the pull_request_target trigger.
safe('S1-no-prt', () => {
  const bad = workflows.filter(wf => 'pull_request_target' in triggers(wf)).map(w => w.file);
  check('S1-no-prt', have && bad.length === 0, !have ? none : bad.length ? `pull_request_target in ${bad.join(', ')}` : 'no pull_request_target');
});

// S1-secrets: no secret other than GITHUB_TOKEN, and no `secrets: inherit`.
safe('S1-secrets', () => {
  const bad = workflows.flatMap(wf => [
    ...[...wf.text.matchAll(/secrets\s*(?:\.\s*([A-Za-z_][\w-]*)|\[\s*['"]([^'"]+)['"]\s*\])/g)].map(m => m[1] ?? m[2]).filter(n => n !== 'GITHUB_TOKEN'),
    ...(/secrets:\s*inherit/.test(wf.text) ? ['inherit'] : []),
  ].map(n => `${wf.file}: ${n}`));
  check('S1-secrets', have && bad.length === 0, !have ? none : bad.length ? `secrets: ${bad.join(', ')}` : 'only GITHUB_TOKEN');
});

// S1-pages-trigger: a job deploys Pages (actions/deploy-pages), and it runs only from main or tags: its workflow is
// triggered only by push to main, push of tags or release, or the job or a job it needs checks the ref in `if:`.
safe('S1-pages-trigger', () => {
  const guard = /refs\/heads\/main|refs\/tags\/|ref_name\s*==\s*'main'|ref_type\s*==\s*'tag'/;
  const deploys = workflows.flatMap(wf => jobs(wf).filter(([, j]) => uses(j, /^actions\/deploy-pages@/)).map(([n]) => ({ wf, n })));
  const bad = deploys.filter(({ wf, n }) => {
    const narrow = Object.entries(triggers(wf)).every(([t, c]) => t === 'release' ||
      (t === 'push' && !c?.['branches-ignore'] && (c?.branches ? list(c.branches).every(b => b === 'main') : Boolean(c?.tags))));
    const all = wf.doc.jobs ?? {}, seen = new Set(), todo = [n];
    while (todo.length) { const j = todo.pop(); if (seen.has(j) || !all[j]) continue; seen.add(j); todo.push(...list(all[j].needs)); }
    return !narrow && ![...seen].some(j => guard.test(String(all[j].if ?? '')));
  });
  check('S1-pages-trigger', deploys.length > 0 && bad.length === 0,
    !deploys.length ? 'no job uses actions/deploy-pages' : bad.length ? `deploys from other refs: ${bad.map(d => `${d.wf.file}: ${d.n}`).join(', ')}` : `deploy only from main or tags: ${deploys.map(d => d.wf.file).join(', ')}`);
});

// S1-release: a version source and a tag-triggered release workflow or a release-please configuration.
safe('S1-release', () => {
  const source = ['package.json', 'site/package.json'].filter(p => json(p)?.version).concat(['.release-please-manifest.json', 'VERSION'].filter(p => read(p) !== null));
  const how = [
    ...workflows.filter(wf => triggers(wf).push?.tags).map(w => `${w.file} (tags)`),
    ...workflows.filter(wf => jobs(wf).some(([, j]) => uses(j, /release-please-action@/))).map(w => `${w.file} (release-please)`),
    ...(read('release-please-config.json') !== null ? ['release-please-config.json'] : []),
  ];
  check('S1-release', source.length > 0 && how.length > 0, `version source: ${source.join(', ') || 'none'}; release: ${how.join(', ') || 'none'}`);
});

// S1-changelog: CHANGELOG.md (root or site/) exists, and it or the README names its format.
safe('S1-changelog', () => {
  const file = ['CHANGELOG.md', 'site/CHANGELOG.md'].find(p => read(p) !== null);
  const fmt = /keep a changelog|keepachangelog|conventional[- ]changelog|release-please|git-cliff|changesets/i;
  const stated = file && [file, 'README.md', 'CONTRIBUTING.md', '.github/CONTRIBUTING.md'].some(p => fmt.test(read(p) ?? ''));
  check('S1-changelog', Boolean(file && stated), !file ? 'no CHANGELOG.md' : stated ? `${file}, format stated` : `${file}, format not stated`);
});

// S1-dependency-updates: Dependabot (version 2, an npm entry for /site) or a Renovate configuration.
safe('S1-dependency-updates', () => {
  const dbFile = ['.github/dependabot.yml', '.github/dependabot.yaml'].find(p => read(p) !== null);
  let db = null;
  try { db = dbFile && YAML.parse(read(dbFile)); } catch {}
  const npmSite = list(db?.updates).some(u => u?.['package-ecosystem'] === 'npm' &&
    [...list(u.directory), ...list(u.directories)].some(d => posix.normalize(`/${d}/`) === '/site/'));
  const renovate = ['renovate.json', 'renovate.json5', '.renovaterc', '.renovaterc.json', '.renovaterc.json5', '.github/renovate.json', '.github/renovate.json5']
    .find(p => read(p) !== null) ?? (json('package.json')?.renovate ? 'package.json' : null);
  check('S1-dependency-updates', Boolean((db?.version === 2 && npmSite) || renovate),
    renovate ? `renovate: ${renovate}` : dbFile ? `${dbFile}: version ${db?.version}, npm for /site: ${npmSite}` : 'no dependabot or renovate configuration');
});

// S1-readme-sections: README.md covers install, develop, test, build, data contribution and license.
safe('S1-readme-sections', () => {
  const md = read('README.md') ?? '';
  const topics = {
    install: /\binstall/i, develop: /\bdevelop|npm run dev\b/i, test: /\btest/i, build: /\bbuild/i,
    'data contribution': /\b(add|contribut|correct|submit)\w*\b[^\n]{0,80}\b(data|records?)\b|\b(data|records?)\b[^\n]{0,80}\bcontribut/i,
    license: /licen[cs]e/i,
  };
  const missing = Object.keys(topics).filter(k => !topics[k].test(md));
  check('S1-readme-sections', md.split('\n').length > 3 && missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : 'all topics present');
});

// S1-readme-commands: README.md shows npm commands, and every npm script it shows exists in package.json or site/package.json.
safe('S1-readme-commands', () => {
  const known = { ...scripts('.'), ...scripts('site') };
  const calls = npmCalls((read('README.md') ?? '').replace(/`/g, '\n'));
  const missing = [...new Set(calls.map(c => c.script).filter(s => !(s in known)))];
  check('S1-readme-commands', calls.length > 0 && missing.length === 0, !calls.length ? 'no npm commands' : missing.length ? `missing scripts: ${missing.join(', ')}` : `${calls.length} npm script commands, all defined`);
});

// S1-commits: at least one agent commit after the baseline (the harness commits "chore: project setup" and
// "chore: scaffold" do not count), and every non-merge agent subject is a Conventional Commit.
// shortcut: only Conventional Commits is verified, so another stated convention fails; upgrade if trials state one.
safe('S1-commits', () => {
  const git = (...a) => { try { return execFileSync('git', ['-c', 'safe.directory=*', '-C', WS, ...a], { encoding: 'utf8' }).trim(); } catch { return ''; } };
  const root = git('rev-list', '--max-parents=0', 'HEAD').split('\n').pop();
  const subjects = root ? git('log', '--no-merges', '--format=%s', `${root}..HEAD`).split('\n')
    .filter(s => s && s !== 'chore: project setup' && s !== 'chore: scaffold') : [];
  const bad = subjects.filter(s => !/^[a-z]+(\([^()]+\))?!?: \S/.test(s));
  const stated = ['README.md', 'CONTRIBUTING.md', '.github/CONTRIBUTING.md'].some(p => /conventional commits/i.test(read(p) ?? ''));
  const dirty = git('status', '--porcelain').split('\n').filter(Boolean).length;
  check('S1-commits', subjects.length > 0 && bad.length === 0,
    `${subjects.length} agent commits after the baseline${bad.length ? `, not conventional: ${bad.slice(0, 3).map(s => JSON.stringify(s)).join(', ')}` : ''}; convention stated: ${stated}; uncommitted files: ${dirty}`);
});

process.stdout.write(JSON.stringify({ checks }, null, 2) + '\n');
