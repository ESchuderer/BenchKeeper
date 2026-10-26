import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
  assert.deepEqual(levels(found, 'rules'), ['error']);
  assert.ok(found.some((i) => i.check === 'unexpected' && /\.claude\/skills\/stray/.test(i.message)));
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
