import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import { main } from '../src/cli.mjs';
import { doctor } from '../src/doctor.mjs';
import { apply, context, preview } from '../src/runner.mjs';
import { globalPlan } from '../src/steps/global.mjs';

const SECRET = 'value-not-for-reports';
function machine({ engine = true } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'bk-doc-'));
  const run = (argv) => {
    if (argv[0] === 'npm') return { code: 1, stdout: '', stderr: '' };
    if (['podman', 'docker'].includes(argv[0])) return { code: engine ? 0 : 127, stdout: '', stderr: '' };
    return { code: 0, stdout: argv.includes('--json') ? '[]' : '1.0.0', stderr: '' };
  };
  return context({ home, run });
}
const levels = (found, check) => found.filter((i) => i.check === check).map((i) => i.level);

test('feature switches: environment, shell files, settings; names and places, never values', () => {
  const ctx = machine();
  writeFileSync(join(ctx.home, '.bashrc'), `# export DO_NOT_TRACK=1\nexport DO_NOT_TRACK=${SECRET}\n`);
  mkdirSync(join(ctx.home, '.config/fish/conf.d'), { recursive: true });
  writeFileSync(join(ctx.home, '.config/fish/conf.d/x.fish'), `set -gx DISABLE_GROWTHBOOK ${SECRET}\n`);
  mkdirSync(join(ctx.home, '.claude'));
  writeFileSync(join(ctx.home, '.claude/settings.json'), JSON.stringify({ env: { DISABLE_TELEMETRY: SECRET } }));
  const found = doctor(ctx, { agents: ['claude'], env: { CLAUDE_CODE_DISABLE_ADVISOR_TOOL: SECRET } });
  const env = found.filter((i) => i.check === 'env').map((i) => i.message);
  assert.deepEqual(env, [
    'CLAUDE_CODE_DISABLE_ADVISOR_TOOL is set in the environment',
    'DO_NOT_TRACK is set in ~/.bashrc:2',
    'DISABLE_GROWTHBOOK is set in ~/.config/fish/conf.d/x.fish:1',
    'DISABLE_TELEMETRY is set in ~/.claude/settings.json (env)',
  ]);
  assert.ok(!JSON.stringify(found).includes(SECRET));
});

test('global drift: rules changed after apply are an error, unexpected items a warning, no engine a warning', () => {
  const ctx = machine({ engine: false });
  apply(preview(globalPlan({ ctx, agents: ['claude'], devcontainerCli: '1.0.0' })), ctx);
  let found = doctor(ctx, { agents: ['claude'], env: {}, devcontainerCli: '1.0.0' });
  assert.deepEqual(levels(found, 'rules'), []);
  assert.ok(!found.some((i) => /tier band/.test(i.message)), 'the optional tier band left off is not drift');
  assert.deepEqual(levels(found, 'plugin'), ['error', 'error', 'warning', 'warning']);
  assert.equal(found.find((i) => i.check === 'plugin').message, 'not installed: Claude Code marketplace benchkeeper');
  assert.ok(found.some((i) => i.message === 'no container engine (podman or docker)'));
  appendFileSync(join(ctx.home, '.claude/rules/00-global.md'), 'my own line\n');
  mkdirSync(join(ctx.home, '.claude/skills/stray'), { recursive: true });
  found = doctor(ctx, { agents: ['claude'], env: {}, devcontainerCli: '1.0.0' });
  assert.deepEqual(levels(found, 'rules'), ['warning'], 'edited rules are a warning');
  assert.ok(found.some((i) => i.check === 'unexpected' && /\.claude\/skills\/stray/.test(i.message)));
  rmSync(join(ctx.home, '.claude/rules/00-global.md'));
  assert.deepEqual(levels(doctor(ctx, { agents: ['claude'], env: {}, devcontainerCli: '1.0.0' }), 'rules'), ['error'], 'a missing rules file is an error');
});

test('keep your edits: an optional change that silences the rules warning until the file or the setup version changes', () => {
  const ctx = { ...machine({ engine: false }), appVersion: '6.0.0' };
  apply(preview(globalPlan({ ctx, agents: ['claude'], devcontainerCli: '1.0.0' })), ctx);
  const plan = () => globalPlan({ ctx, agents: ['claude'], devcontainerCli: '1.0.0' });
  const rules = () => levels(doctor(ctx, { agents: ['claude'], env: {}, devcontainerCli: '1.0.0' }), 'rules');
  assert.deepEqual(plan().filter((c) => c.step === 'rulesKeep:claude'), [], 'nothing to keep while the file matches');
  const file = join(ctx.home, '.claude/rules/00-global.md');
  appendFileSync(file, 'my own line\n');
  const [keep] = plan().filter((c) => c.step === 'rulesKeep:claude');
  assert.ok(keep.optional && preview([keep])[0].selected === false);
  // Chosen with the rules write in one plan, keep wins: the edits stay and the rules write is not applied.
  const full = plan();
  const write = full.find((c) => c.step === 'rules:claude');
  assert.equal(keep.replaces, write.id);
  assert.equal(apply(preview(full), ctx, { select: [write.id, full.find((c) => c.step === 'rulesKeep:claude').id] }).status, 'done');
  assert.match(readFileSync(file, 'utf8'), /my own line/);
  assert.deepEqual(rules(), []);
  assert.deepEqual(plan().filter((c) => c.step.startsWith('rules')), [], 'neither the rules write nor the keep offer is planned');
  appendFileSync(file, 'one more\n');
  assert.deepEqual(rules(), ['warning'], 'a new edit is reported again');
  ctx.appVersion = '6.1.0';
  assert.equal(plan().filter((c) => c.step === 'rulesKeep:claude').length, 1);
});

test('a rules path that is a dangling link counts as a missing rules file, an error', { skip: process.platform === 'win32' }, () => {
  const ctx = { ...machine({ engine: false }), appVersion: '6.0.0' };
  apply(preview(globalPlan({ ctx, agents: ['claude'], devcontainerCli: '1.0.0' })), ctx);
  const file = join(ctx.home, '.claude/rules/00-global.md');
  rmSync(file);
  symlinkSync(join(ctx.home, 'nowhere.md'), file);
  assert.deepEqual(levels(doctor(ctx, { agents: ['claude'], env: {}, devcontainerCli: '1.0.0' }), 'rules'), ['error']);
});

test('an older plugin is outdated, a warning, once per agent', () => {
  const ctx = { ...machine(), appVersion: '6.0.0' };
  mkdirSync(join(ctx.home, '.claude/plugins'), { recursive: true });
  writeFileSync(join(ctx.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'benchkeeper@benchkeeper': [{ scope: 'user', version: '0.1.0' }] } }));
  writeFileSync(join(ctx.home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ benchkeeper: { source: { ref: 'stable' } } }));
  writeFileSync(join(ctx.home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'benchkeeper@benchkeeper': true } }));
  const found = doctor(ctx, { agents: ['claude'], env: {}, devcontainerCli: '1.0.0' }).filter((i) => /benchkeeper@benchkeeper/.test(i.message));
  assert.deepEqual(found.map((i) => [i.level, i.tag, i.message]), [['warning', 'outdated', `Claude Code plugin benchkeeper@benchkeeper 0.1.0 to ${ctx.appVersion}`]]);
});

test('project: summary sections, overlapping descriptions, broken links; exit 1 on an error', async () => {
  const ctx = machine();
  const dir = mkdtempSync(join(tmpdir(), 'bk-doc-proj-'));
  writeFileSync(join(dir, 'AGENTS.md'), '# P\n\n## Project structure\n\n- src/\n');
  const skill = (name, desc, body = '') => {
    mkdirSync(join(dir, '.claude/skills', name), { recursive: true });
    writeFileSync(join(dir, '.claude/skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: "${desc}"\n---\n${body}`);
  };
  skill('a', 'Playwright browser tests', 'See [ref](reference.md) and [web](https://example.com).\n');
  skill('b', 'Writing Playwright browser tests');
  for (const [n, d] of [['c', 'Terraform modules'], ['d', 'Statistics'], ['e', 'Release notes'], ['f', 'Database migrations']]) skill(n, d);
  const found = doctor(ctx, { agents: [], dir, env: {} });
  assert.deepEqual(found.filter((i) => ['agents-md', 'skills'].includes(i.check)).map((i) => `${i.level} ${i.message}`), [
    'warning AGENTS.md has a summary or layout section (## Project structure)',
    `error skill a in ${dir}: .claude/skills/a/SKILL.md links reference.md, which does not exist`,
    'warning a and b have overlapping descriptions',
  ]);
  let text = '';
  const out = new Writable({ write(c, _, done) { text += c; done(); } });
  assert.equal(await main(['doctor', dir, '--agents', 'claude'], { out, ctx }), 1);
  assert.match(text, /^error +skills +skill a in .*: \.claude\/skills\/a\/SKILL\.md links reference\.md/m);
  assert.match(text, /\d+ errors, \d+ warnings\n$/);
});
