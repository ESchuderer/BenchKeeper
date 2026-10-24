import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import { BASELINE_REPO, CALLERS, PROFILES, REF, baselineIssues, callerFile, githubSlug, loadProfile } from '../src/baseline.mjs';
import { main } from '../src/cli.mjs';
import { doctor } from '../src/doctor.mjs';
import { addProject } from '../src/projects.mjs';
import { context, preview, runCommand } from '../src/runner.mjs';
import { projectPlan } from '../src/steps/project.mjs';

const profile = (name) => JSON.parse(readFileSync(new URL(`../src/baseline/profiles/${name}.json`, import.meta.url), 'utf8'));
const OSS = profile('oss');
const withChecks = (rs, checks) => structuredClone({ ...rs, id: rs.name === 'develop' ? 1 : 2, source_type: 'Repository', rules: [...rs.rules, { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: false, required_status_checks: checks.map((context) => ({ context })) } }] });

// What gh answers for a repository that matches the oss profile; tests change a copy.
const compliant = () => ({
  private: false,
  repo: { ...OSS.repo },
  actions: { ...OSS.actions },
  selected: { ...OSS.selected },
  workflow: { ...OSS.workflow },
  pvr: true, alerts: true, fixes: true, code: 'configured', scanning: true, pushProtection: true,
  rulesets: [withChecks(OSS.rulesets[0], ['build', 'dependency-review']), withChecks(OSS.rulesets[1], ['build'])],
});

// A gh that answers GET requests from db, records every call, and serves repo-baseline's profile files.
function stub(db) {
  const calls = [];
  const bad = (code, msg) => ({ code: 1, stdout: '', stderr: `gh: ${msg} (HTTP ${code})\n` });
  const ok = (v) => ({ code: 0, stdout: v === undefined ? '' : JSON.stringify(v), stderr: '' });
  const run = (argv, o) => {
    if (argv[0] === 'git') return runCommand(argv, o);
    if (argv[0] !== 'gh') return { code: 1, stdout: '', stderr: '' };
    calls.push(argv);
    if (db.offline) return { code: 1, stdout: '', stderr: 'error connecting to api.github.com\n' };
    const target = argv.find((a) => a.startsWith('repos/'));
    if (target.startsWith(`repos/${BASELINE_REPO}/contents/`)) return db.baselineDown ? bad(404, 'Not Found') : { code: 0, stdout: readFileSync(new URL(`../src/baseline/${target.match(/contents\/([^?]+)/)[1]}`, import.meta.url), 'utf8'), stderr: '' };
    const path = target.replace(/^repos\/[^/]+\/[^/]+/, '');
    if (path === '') return ok({ private: db.private, ...db.repo, security_and_analysis: { secret_scanning: { status: db.scanning ? 'enabled' : 'disabled' }, secret_scanning_push_protection: { status: db.pushProtection ? 'enabled' : 'disabled' } } });
    if (path === '/actions/permissions') return ok(db.actions);
    if (path === '/actions/permissions/selected-actions') return ok(db.selected);
    if (path === '/actions/permissions/workflow') return ok(db.workflow);
    if (path === '/private-vulnerability-reporting') return db.private ? bad(404, 'Not Found') : ok({ enabled: db.pvr });
    if (path === '/automated-security-fixes') return ok({ enabled: db.fixes, paused: false });
    if (path === '/code-scanning/default-setup') return db.private ? bad(403, 'Code scanning is not enabled') : ok({ state: db.code });
    if (path === '/vulnerability-alerts') return db.alerts ? ok() : bad(404, 'Vulnerability alerts are disabled.');
    if (path.startsWith('/rulesets')) {
      if (db.rulesets === null) return bad(403, 'Upgrade to GitHub Pro or make this repository public to enable this feature.');
      const id = Number(path.split('/')[2]);
      return id ? ok(db.rulesets.find((r) => r.id === id)) : ok(db.rulesets.map(({ id: i, name }) => ({ id: i, name })));
    }
    return bad(404, `unexpected ${path}`);
  };
  return { run, calls };
}

// A checkout whose origin is on GitHub, with the promote caller (pinned) and Dependabot.
function checkout({ promote = `${BASELINE_REPO}/.github/workflows/promote.yml@${'a'.repeat(40)}`, dependabot = true, remote = 'https://github.com/o/r.git' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bk-base-'));
  const git = (...a) => runCommand(['git', '-C', dir, ...a]);
  git('init', '-q');
  if (remote) git('remote', 'add', 'origin', remote);
  mkdirSync(join(dir, '.github/workflows'), { recursive: true });
  if (promote) writeFileSync(join(dir, '.github/workflows/promote.yml'), `jobs:\n  promote:\n    uses: ${promote}\n`);
  if (dependabot) writeFileSync(join(dir, '.github/dependabot.yml'), 'version: 2\n');
  return dir;
}
const machine = (db) => { const g = stub(db); return { ctx: context({ home: mkdtempSync(join(tmpdir(), 'bk-home-')), run: g.run }), calls: g.calls }; };
const messages = (issues) => issues.map((i) => i.message.replace(/^o\/r: /, ''));
const WRITE = /^(-X|--method|-f|-F|--field|--raw-field|--input)$/;

test('a repository that matches the profile reports nothing but the match, and only GET requests were sent', () => {
  const { ctx, calls } = machine(compliant());
  const found = baselineIssues(ctx, checkout(), { profile: 'oss' });
  assert.deepEqual(found.map((i) => [i.level, i.check]), [['info', 'baseline']]);
  assert.match(found[0].message, /matches profile oss/);
  assert.ok(calls.length > 5);
  for (const argv of calls) assert.ok(!argv.some((a) => WRITE.test(a)), argv.join(' '));
});

test('drift is reported per setting: merge methods, token, allowlist, security, rulesets, checks, callers', () => {
  const db = compliant();
  db.repo.allow_rebase_merge = true;
  db.workflow.default_workflow_permissions = 'write';
  db.selected.patterns_allowed = [];
  db.pvr = false;
  db.code = 'not-configured';
  db.rulesets = [withChecks({ ...OSS.rulesets[0], enforcement: 'disabled' }, ['build']), withChecks(OSS.rulesets[1], ['build', 'dependency-review', 'only-main'])];
  db.rulesets[0].rules.find((r) => r.type === 'pull_request').parameters.allowed_merge_methods = ['merge', 'squash'];
  const { ctx } = machine(db);
  const found = messages(baselineIssues(ctx, checkout({ promote: null, dependabot: false }), { profile: 'oss' }));
  assert.deepEqual(found, [
    'repository allow_rebase_merge is true, the profile wants false',
    'workflow token default_workflow_permissions is write, the profile wants read',
    'security private_vulnerability_reporting is false, the profile wants true',
    'security code_scanning_default_setup is not-configured, the profile wants configured',
    `Actions allowlist lacks ${OSS.selected.patterns_allowed[0]}`,
    'ruleset develop enforcement is disabled, the profile wants active',
    'ruleset develop allowed_merge_methods is ["merge","squash"], the profile wants ["squash"]',
    'ruleset main requires checks that develop does not require (dependency-review, only-main): they may not have run on the promotion pull request',
    'ruleset main requires dependency-review, which runs on pull requests only and never reports on the promotion pull request',
    'caller workflow promote is missing',
    '.github/dependabot.yml is missing',
  ]);
  assert.ok(baselineIssues(ctx, checkout(), { profile: 'oss' }).every((i) => i.level !== 'error'));
});

test('a ruleset set by hand under another name counts when it targets the same branches', () => {
  const db = compliant();
  db.rulesets[1].name = 'default branch';
  const { ctx } = machine(db);
  assert.deepEqual(baselineIssues(ctx, checkout(), { profile: 'oss' }).map((i) => i.level), ['info']);
  db.rulesets[1].conditions.ref_name.include = ['refs/heads/release'];
  assert.deepEqual(messages(baselineIssues(ctx, checkout(), { profile: 'oss' })), ['ruleset main is missing']);
});

test('rulesets without checks and a caller that is not pinned to a commit are reported', () => {
  const db = compliant();
  db.rulesets = OSS.rulesets.map((r, i) => structuredClone({ ...r, id: i + 1, source_type: 'Repository' }));
  const { ctx } = machine(db);
  const found = messages(baselineIssues(ctx, checkout({ promote: `${BASELINE_REPO}/.github/workflows/promote.yml@v0.1.0` }), { profile: 'oss' }));
  assert.deepEqual(found, ['ruleset develop requires no status checks', 'ruleset main requires no status checks', 'caller workflow promote is not pinned to a commit (v0.1.0)']);
});

test('without gh, a login or the network the check says so, and nothing throws', () => {
  const { ctx } = machine({ offline: true });
  const found = baselineIssues(ctx, checkout(), { profile: 'auto' });
  assert.equal(found.length, 1);
  assert.match(found[0].message, /GitHub settings of o\/r not checked: error connecting/);
  assert.equal(found[0].level, 'warning');
  assert.deepEqual(baselineIssues(ctx, checkout({ remote: null })).map((i) => i.message), ['GitHub settings not checked: no GitHub origin']);
  assert.deepEqual(baselineIssues(ctx, checkout({ remote: 'https://gitlab.com/o/r.git' })).length, 1);
});

test('the profile falls back to the bundled copy when repo-baseline is unreachable; another ref has no fallback', () => {
  const { ctx } = machine({ baselineDown: true });
  const r = loadProfile(ctx, 'oss');
  assert.deepEqual(r.profile, OSS);
  assert.match(r.source, /bundled copy of ESchuderer\/repo-baseline@/);
  assert.throws(() => loadProfile(ctx, 'oss', 'feature/x'), /cannot read profile oss at ESchuderer\/repo-baseline@feature\/x/);
  assert.throws(() => loadProfile(ctx, 'oss', '--evil'), /not a ref/);
  assert.throws(() => loadProfile(ctx, '../oss'), /profile must be one of/);
  const live = machine(compliant());
  assert.match(loadProfile(live.ctx, 'oss').source, new RegExp(`^${BASELINE_REPO}@${REF.slice(0, 7)}$`));
  assert.ok(live.calls[0].some((a) => a.endsWith(`?ref=${REF}`)));
});

test('a private repository gets the advisory profile: findings tagged advisory, what the plan lacks named', () => {
  const db = compliant();
  db.private = true;
  db.rulesets = null;
  db.repo.allow_rebase_merge = true;
  const { ctx } = machine(db);
  const found = baselineIssues(ctx, checkout(), { profile: 'auto' });
  assert.ok(found.every((i) => i.tag === 'advisory' && i.level === 'warning'));
  const text = messages(found);
  assert.ok(text.includes('repository allow_rebase_merge is true, the profile wants false'));
  assert.ok(text.some((m) => /rulesets not readable \(HTTP 403\)/.test(m)));
  assert.ok(found.every((i) => /advisory/.test(i.fix) || /plan|token/.test(i.fix)));
});

test('doctor adds the baseline findings only when asked, and exit stays 0 for warnings', async () => {
  const dir = checkout({ promote: null });
  const { ctx } = machine(compliant());
  assert.ok(!doctor(ctx, { agents: [], dir, env: {}, devcontainerCli: '1.0.0' }).some((i) => i.check === 'baseline'));
  assert.ok(doctor(ctx, { agents: [], dir, env: {}, devcontainerCli: '1.0.0', baseline: { profile: 'oss' } }).some((i) => /caller workflow promote is missing/.test(i.message)));
  let text = '';
  const out = new Writable({ write(c, _, done) { text += c; done(); } });
  await main(['doctor', dir, '--agents', 'claude', '--baseline', 'oss'], { out, ctx });
  assert.match(text, /warning\s+baseline\s+o\/r: caller workflow promote is missing\n\s+fix: benchkeeper project apply --caller promote/);
  assert.equal(await main(['doctor', dir, '--baseline', 'nope'], { out, ctx }), 2);
});

test('update-all --baseline reports each project and changes no setting and no file', async () => {
  const dir = checkout({ promote: null });
  const { ctx, calls } = machine(compliant());
  addProject(ctx, dir);
  let text = '';
  const out = new Writable({ write(c, _, done) { text += c; done(); } });
  await main(['update-all', '--baseline', 'auto'], { out, ctx, input: undefined });
  assert.match(text, /GitHub settings against profile auto \(report only\)\n\s+warning\s+o\/r: caller workflow promote is missing/);
  for (const argv of calls) assert.ok(!argv.some((a) => WRITE.test(a)));
  assert.equal(runCommand(['git', '-C', dir, 'status', '--porcelain']).stdout.includes('promote'), false);
});

test('project setup writes a repo-baseline caller only when asked; an own file is offered, not preselected', () => {
  const dir = checkout({ promote: null, dependabot: false });
  const { ctx } = machine(compliant());
  const answers = { agents: ['claude'], env: 'container' };
  const none = preview(projectPlan({ ctx, dir, answers }).changes);
  assert.ok(!none.some((c) => c.step.startsWith('caller:')));
  const [c] = preview(projectPlan({ ctx, dir, answers: { ...answers, callers: ['promote'] } }).changes).filter((x) => x.step === 'caller:promote');
  assert.equal(c.selected, true);
  assert.equal(c.path, join(dir, '.github/workflows/promote.yml'));
  assert.match(c.after, new RegExp(`uses: ${BASELINE_REPO}/\\.github/workflows/promote\\.yml@${REF}\\n$`));
  assert.ok(!c.after.includes('{{ref}}'));
  writeFileSync(join(dir, '.github/workflows/promote.yml'), 'name: mine\n');
  const [own] = preview(projectPlan({ ctx, dir, answers: { ...answers, callers: ['promote'] } }).changes).filter((x) => x.step === 'caller:promote');
  assert.equal(own.selected, false);
  assert.match(own.title, /replaces your own file/);
  writeFileSync(join(dir, '.github/workflows/promote.yml'), callerFile('promote').text);
  assert.ok(!preview(projectPlan({ ctx, dir, answers: { ...answers, callers: ['promote'] } }).changes).some((x) => x.step === 'caller:promote'));
  assert.throws(() => projectPlan({ ctx, dir, answers: { ...answers, callers: ['evil'] } }), /caller must be one of/);
});

test('the bundled copy: pinned commit, valid profiles, every caller pinned and a workflow of its own', () => {
  assert.match(REF, /^[0-9a-f]{40}$/);
  assert.notEqual(REF, '0'.repeat(40));
  for (const name of PROFILES) assert.equal(profile(name).name, name);
  assert.equal(profile('private-advisory').advisory, true);
  for (const m of CALLERS) {
    const f = callerFile(m);
    assert.equal(f.path, `.github/workflows/${m}.yml`);
    assert.match(f.text, new RegExp(`uses: ${BASELINE_REPO}/\\.github/workflows/${m}\\.yml@[0-9a-f]{40}\\n`));
  }
  assert.throws(() => callerFile('../x'), /unknown caller/);
});

test('origin urls: ssh and https on GitHub give owner/repo, anything else none', () => {
  const ctx = context({ home: tmpdir() });
  for (const [url, want] of [['git@github.com:o/r.git', 'o/r'], ['https://github.com/o/r', 'o/r'], ['https://github.com/o/r.git/', 'o/r'], ['https://example.com/o/r', null], ['https://github.com/o/-r', null]]) {
    const dir = checkout({ remote: url });
    assert.equal(githubSlug(ctx, dir), want, url);
  }
});
