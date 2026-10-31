import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import { main } from '../src/cli.mjs';
import { appVersion, contentVersion } from '../src/content.mjs';
import { doctor } from '../src/doctor.mjs';
import { levelCounts } from '../src/levels.mjs';
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

test('the summary counts each level in the singular or plural, info included, and leaves a zero level out', () => {
  assert.equal(levelCounts([{ level: 'error' }, { level: 'warning' }, { level: 'warning' }]).text, '1 error, 2 warnings');
  assert.equal(levelCounts([{ level: 'info' }, { level: 'info' }]).text, '2 info');
  assert.equal(levelCounts([]).text, '');
});

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

test('the skill install preview sandbox: doctor names what is missing, from the programs alone, and is quiet when srt can run', () => {
  const ctx = machine();
  const sandbox = (facts) => { ctx.sandbox = facts; return doctor(ctx, { agents: ['claude'], env: {}, devcontainerCli: '1.0.0' }).filter((i) => i.check === 'sandbox'); };
  assert.deepEqual(sandbox({ platform: 'linux', has: () => true, node: '22.22.0' }), []);
  const none = sandbox({ platform: 'linux', has: () => false, node: '22.22.0' });
  assert.deepEqual(none.map((i) => i.level), ['info']);
  assert.match(none[0].message, /^the skill install preview is off: bwrap is missing: install bubblewrap, socat and ripgrep/);
  assert.match(none[0].fix, /Rehearse anyway without a sandbox/);
  assert.match(sandbox({ platform: 'win32' })[0].message, /Windows has no sandbox the app can use \(unsupported\)/);
  assert.match(sandbox({ platform: 'linux', has: (b) => b !== 'rg', node: '22.22.0' })[0].message, /^the skill install preview confines writes only: rg missing/);
  const old = sandbox({ platform: 'linux', has: () => true, node: '22.5.0' })[0];
  assert.equal(old.fix, 'use Node 22.12 or newer');
});

test('global drift: rules changed after apply are an error, the user\'s own items no finding, no engine a warning', () => {
  const ctx = machine({ engine: false });
  apply(preview(globalPlan({ ctx, agents: ['claude'], devcontainerCli: '1.0.0' })), ctx);
  let found = doctor(ctx, { agents: ['claude'], env: {}, devcontainerCli: '1.0.0' });
  assert.deepEqual(levels(found, 'rules'), []);
  assert.ok(!found.some((i) => /status band/.test(i.message)), 'the optional status band left off is not drift');
  assert.deepEqual(levels(found, 'plugin'), ['error', 'error']);
  assert.equal(found.find((i) => i.check === 'plugin').message, 'not installed: Claude Code marketplace benchkeeper');
  assert.ok(found.some((i) => i.message === 'no container engine (podman or docker)'));
  appendFileSync(join(ctx.home, '.claude/rules/00-global.md'), 'my own line\n');
  mkdirSync(join(ctx.home, '.claude/skills/stray'), { recursive: true });
  found = doctor(ctx, { agents: ['claude'], env: {}, devcontainerCli: '1.0.0' });
  assert.deepEqual(levels(found, 'rules'), ['warning'], 'edited rules are a warning');
  assert.ok(!found.some((i) => /\.claude\/skills\/stray/.test(i.message)), 'a global skill of the user is no finding');
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

test('a rules file with an unmatched marker is an error of its own change; the rest of the plan stays', () => {
  const ctx = { ...machine({ engine: false }), appVersion: '6.0.0' };
  apply(preview(globalPlan({ ctx, agents: ['codex'], devcontainerCli: '1.0.0' })), ctx);
  const file = join(ctx.home, '.codex/AGENTS.md');
  writeFileSync(file, '<!-- benchkeeper:rules start -->\nbroken\n');
  const p = preview(globalPlan({ ctx, agents: ['codex'], devcontainerCli: '1.0.0' }));
  assert.ok(p.find((c) => c.step === 'rules:codex')?.error, 'the error is on the rules change');
  assert.equal(p.filter((c) => c.step === 'rulesKeep:codex').length, 0);
});

test('a rules path that is a dangling link counts as a missing rules file, an error', { skip: process.platform === 'win32' }, () => {
  const ctx = { ...machine({ engine: false }), appVersion: '6.0.0' };
  apply(preview(globalPlan({ ctx, agents: ['claude'], devcontainerCli: '1.0.0' })), ctx);
  const file = join(ctx.home, '.claude/rules/00-global.md');
  rmSync(file);
  symlinkSync(join(ctx.home, 'nowhere.md'), file);
  assert.deepEqual(levels(doctor(ctx, { agents: ['claude'], env: {}, devcontainerCli: '1.0.0' }), 'rules'), ['error']);
});

test('an older BenchKeeper plugin is no finding: the agent\'s own update decides', () => {
  const ctx = { ...machine(), appVersion: '6.0.0' };
  mkdirSync(join(ctx.home, '.claude/plugins'), { recursive: true });
  writeFileSync(join(ctx.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'benchkeeper@benchkeeper': [{ scope: 'user', version: '0.1.0' }] } }));
  writeFileSync(join(ctx.home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ benchkeeper: { source: { ref: 'stable' } } }));
  writeFileSync(join(ctx.home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'benchkeeper@benchkeeper': true } }));
  const found = doctor(ctx, { agents: ['claude'], env: {}, devcontainerCli: '1.0.0' }).filter((i) => /benchkeeper@benchkeeper/.test(i.message));
  assert.deepEqual(found, []);
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
  assert.match(text, /\n\d+ errors?(, \d+ warnings?)?(, \d+ info)?\n$/);
});

test('feature switches: every name, every shell start file, both settings files; comments and other keys are not findings', () => {
  const ctx = machine();
  const vars = ['DISABLE_TELEMETRY', 'DO_NOT_TRACK', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'DISABLE_GROWTHBOOK', 'CLAUDE_CODE_DISABLE_ADVISOR_TOOL'];
  const rc = ['.bashrc', '.bash_profile', '.profile', '.zshrc', '.zprofile', '.zshenv', '.config/fish/config.fish'];
  mkdirSync(join(ctx.home, '.config/fish/conf.d'), { recursive: true });
  rc.forEach((f, i) => writeFileSync(join(ctx.home, f), `  # export ${vars[0]}=1\nexport ${vars[i % vars.length]}=1 # on purpose\nexport MY_DO_NOT_TRACK_X=1\n`));
  writeFileSync(join(ctx.home, '.config/fish/conf.d/notes.txt'), `${vars[1]}\n`);
  mkdirSync(join(ctx.home, '.claude'));
  writeFileSync(join(ctx.home, '.claude/settings.local.json'), JSON.stringify({ env: { DO_NOT_TRACK: '1', OTHER: '1' } }));
  const found = doctor(ctx, { agents: ['claude'], env: Object.fromEntries(vars.map((v) => [v, ''])) }).filter((i) => i.check === 'env');
  assert.deepEqual(found.slice(0, 5).map((i) => i.message), vars.map((v) => `${v} is set in the environment`));
  assert.equal(found[0].fix, 'unset it where it is exported, unless you turned that feature off on purpose');
  assert.deepEqual(found.slice(5, -1).map((i) => i.message), rc.map((f, i) => `${vars[i % vars.length]} is set in ~/${f}:2`));
  assert.equal(found[5].fix, 'remove that line, unless you turned that feature off on purpose');
  assert.deepEqual(found.at(-1), { level: 'warning', check: 'env', message: 'DO_NOT_TRACK is set in ~/.claude/settings.local.json (env)', fix: 'remove the key, unless you turned that feature off on purpose' });
});

test('global drift: the fix names the level below full, plain apply at full; missing parts keep their text', () => {
  const ctx = machine();
  apply(preview(globalPlan({ ctx, agents: ['claude'], devcontainerCli: '1.0.0' })), ctx);
  const found = doctor(ctx, { agents: ['claude'], env: {}, devcontainerCli: '1.0.0' });
  assert.deepEqual(found.find((i) => i.check === 'plugin'), { level: 'error', check: 'plugin', message: 'not installed: Claude Code marketplace benchkeeper', fix: 'benchkeeper apply' });
  assert.equal(found.filter((i) => i.message === 'not installed: Claude Code marketplace benchkeeper').length, 1, 'one finding per step');
  appendFileSync(join(ctx.home, '.claude/rules/00-global.md'), 'my own line\n');
  const rules = doctor(ctx, { agents: ['claude'], env: {}, devcontainerCli: '1.0.0' }).find((i) => i.check === 'rules');
  assert.match(rules.message, / differs from setup \d+\.\d+\.\d+$/);
  assert.match(rules.fix, /^benchkeeper apply restores them; the optional "keep your edits" change/);
});

test('a container engine: docker alone is enough', () => {
  const home = mkdtempSync(join(tmpdir(), 'bk-doc-'));
  const ctx = context({ home, run: (argv) => ({ code: argv[0] === 'podman' || argv[0] === 'npm' ? 127 : 0, stdout: argv.includes('--json') ? '[]' : '1.0.0', stderr: '' }) });
  assert.ok(!doctor(ctx, { agents: ['claude'], env: {}, devcontainerCli: '1.0.0' }).some((i) => i.message === 'no container engine (podman or docker)'));
});

test('a pack with its own setup skill: missing folder is a warning with a start line, missing sections info, quiet when both exist', () => {
  const ctx = machine();
  const dir = mkdtempSync(join(tmpdir(), 'bk-doc-pack-'));
  mkdirSync(join(dir, '.benchkeeper'));
  const state = (agents) => writeFileSync(join(dir, '.benchkeeper/state.json'), JSON.stringify({ schemaVersion: 2, appVersion, contentVersion, agents, packs: ['matt-pocock'], share: true }));
  const packs = () => doctor(ctx, { agents: [], dir, env: {} }).filter((i) => i.check === 'packs');
  state(['codex']);
  const [missing] = packs();
  assert.equal(missing.level, 'warning');
  assert.equal(missing.message, 'pack matt-pocock is on, but docs/agents/ does not exist');
  assert.match(missing.fix, /^run \$mattpocock-skills:setup-matt-pocock-skills once in this project: it writes `docs\/agents\/`/);
  assert.deepEqual(missing.start, { agent: 'codex', dir, prompt: '$mattpocock-skills:setup-matt-pocock-skills', command: `benchkeeper sessions record --project '${dir}' -- codex '$mattpocock-skills:setup-matt-pocock-skills'` });
  state([]);
  assert.equal(packs()[0].start, undefined, 'no agent, no start line');
  state(['codex', 'claude']);
  mkdirSync(join(dir, 'docs/agents'), { recursive: true });
  writeFileSync(join(dir, 'AGENTS.md'), '# P\n\n### Issue tracker\n');
  assert.deepEqual(packs().map((i) => [i.level, i.message]), [['info', 'pack matt-pocock is on, but ### Issue tracker, ### Triage labels, ### Domain docs are not all in AGENTS.md']]);
  assert.match(packs()[0].fix, /^run \/mattpocock-skills:setup-matt-pocock-skills once/);
  writeFileSync(join(dir, 'CLAUDE.md'), '  ### Triage labels\n### Domain docs\n');
  assert.deepEqual(packs(), []);
});

test('project state: unreadable, committed while local, older than this app, a container env without the Dev Containers CLI', () => {
  const home = mkdtempSync(join(tmpdir(), 'bk-doc-'));
  const ctx = context({ home, run: (argv) => {
    if (argv[0] === 'git' && argv.includes('ls-files')) return { code: 0, stdout: '.benchkeeper/state.json\n', stderr: '' };
    if (argv[0] === 'devcontainer' || argv[0] === 'npm') return { code: 127, stdout: '', stderr: '' };
    return { code: 0, stdout: argv.includes('--json') ? '[]' : '1.0.0', stderr: '' };
  } });
  const dir = mkdtempSync(join(tmpdir(), 'bk-doc-state-'));
  mkdirSync(join(dir, '.benchkeeper'));
  const project = (s) => { writeFileSync(join(dir, '.benchkeeper/state.json'), typeof s === 'string' ? s : JSON.stringify({ schemaVersion: 2, agents: [], ...s })); return doctor(ctx, { agents: [], dir, env: {} }).filter((i) => ['project', 'tools'].includes(i.check)).map(({ level, check, message, fix }) => ({ level, check, message, fix })); };
  const [bad] = project('not json');
  assert.equal(bad.level, 'error');
  assert.equal(bad.fix, 'fix or delete the file, then run benchkeeper projects apply (a newer schemaVersion needs a newer benchkeeper)');
  assert.deepEqual(project({ appVersion, contentVersion, share: true, env: 'host' }), []);
  assert.deepEqual(project({ appVersion: '1.0.0', contentVersion: '1.0', share: false, env: 'host-agent' }), [
    { level: 'warning', check: 'project', message: 'the setup is local, but the repository still has it committed', fix: 'benchkeeper projects unshare: a pull request removes the committed copies' },
    { level: 'warning', check: 'project', message: `project setup: app 1.0.0, content 1.0; this app ${appVersion}, content ${contentVersion}`, fix: 'benchkeeper projects update, or benchkeeper projects apply in the project' },
    { level: 'error', check: 'tools', message: 'env host-agent needs the Dev Containers CLI', fix: 'benchkeeper apply installs it' },
  ]);
  assert.deepEqual(project({ appVersion, contentVersion, env: 'container' }).map((i) => i.message), ['the setup is local, but the repository still has it committed', 'env container needs the Dev Containers CLI']);
});

test('project skills: a link to a web page or an existing file is no finding', () => {
  const ctx = machine();
  const dir = mkdtempSync(join(tmpdir(), 'bk-doc-proj-'));
  mkdirSync(join(dir, '.agents/skills/a'), { recursive: true });
  writeFileSync(join(dir, '.agents/skills/a/ref.md'), '');
  writeFileSync(join(dir, '.agents/skills/a/SKILL.md'), '---\nname: a\ndescription: "A"\n---\nSee [ref](ref.md), [web](http://example.com) and [doc](missing.md).\n');
  assert.deepEqual(doctor(ctx, { agents: [], dir, env: {} }).filter((i) => i.check === 'skills').map((i) => [i.message, i.fix]), [[`skill a in ${dir}: .agents/skills/a/SKILL.md links missing.md, which does not exist`, 'restore the file or fix the link']]);
});
