import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { allowChecks, classify, codexAllows } from '../src/allow.mjs';
import { doctor } from '../src/doctor.mjs';
import { importsOf } from '../src/instructions.mjs';
import { addProject } from '../src/projects.mjs';
import { context } from '../src/runner.mjs';

const SECRET = 'text-the-user-wrote-1f3a';
const TMP = realpathSync(tmpdir());

function machine() {
  const home = mkdtempSync(join(TMP, 'bk-lint-'));
  const dir = mkdtempSync(join(TMP, 'bk-lint-proj-'));
  const run = (argv) => ({ code: ['npm', 'podman', 'docker'].includes(argv[0]) ? 1 : 0, stdout: argv.includes('--json') ? '[]' : '1.0.0', stderr: '' });
  return { ctx: context({ home, run }), home, dir };
}
const tilde = (p) => join('~', p);
const put = (file, text) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, text); };
const skill = (root, name, desc) => put(join(root, name, 'SKILL.md'), `---\nname: ${name}\ndescription: "${desc}"\n---\n${SECRET}\n`);
// Every file below the folders with its content, to prove a check changes none.
function snapshot(...roots) {
  const out = {};
  const walk = (d) => readdirSync(d, { withFileTypes: true }).forEach((e) => { const p = join(d, e.name); if (e.isDirectory()) walk(p); else out[p] = `${readFileSync(p, 'utf8')}${statSync(p).mtimeMs}`; });
  roots.forEach(walk);
  return out;
}
const only = (found, check) => found.filter((i) => i.check === check);

test('importsOf: paths outside code, not e-mail addresses, escaped spaces, trailing punctuation', () => {
  const text = ['@AGENTS.md', 'mail me@example.com', '`@span.md`', '```', '@fenced.md', '```', `see @docs/a.md, and @${tilde('x.md')}.`, 'use @playwright/test and ping @org/team', '@Design\\ Docs/b.md'].join('\n');
  assert.deepEqual(importsOf(text), [{ line: 1, target: 'AGENTS.md' }, { line: 7, target: 'docs/a.md' }, { line: 7, target: tilde('x.md') }, { line: 9, target: 'Design Docs/b.md' }]);
});

test('instruction files: a broken import, a long file and overlapping skills of two scopes, each once with file and line', () => {
  const { ctx, home, dir } = machine();
  put(join(dir, 'AGENTS.md'), `# P\n${SECRET}\n@also-missing.md\n`);
  put(join(dir, 'CLAUDE.md'), `# P\n\n@AGENTS.md\n@docs/missing.md\n\`@in-code.md\`\n`);
  put(join(dir, '.claude/rules/long.md'), `${Array.from({ length: 250 }, (_, i) => `${SECRET} ${i}`).join('\n')}\n`);
  skill(join(dir, '.claude/skills'), 'browser-tests', 'Writing Playwright browser tests');
  skill(join(home, '.claude/skills'), 'playwright', 'Playwright browser tests');
  skill(join(home, '.claude/skills'), 'tf', 'Terraform modules');
  const before = snapshot(home, dir);
  const found = doctor(ctx, { agents: [], dir, env: {} });
  assert.deepEqual(only(found, 'instructions').map((i) => [i.level, i.file, i.line]), [
    ['error', 'AGENTS.md', 3],
    ['error', 'CLAUDE.md', 4],
    ['warning', '.claude/rules/long.md', 201],
  ]);
  assert.match(only(found, 'instructions')[1].message, /^CLAUDE\.md:4 imports docs\/missing\.md, which does not exist$/);
  assert.match(only(found, 'instructions')[2].fix, /code\.claude\.com\/docs\/en\/memory/);
  const overlap = only(found, 'skills');
  assert.equal(overlap.length, 1);
  assert.match(overlap[0].message, /^browser-tests \(project, \.claude\/skills\/browser-tests\/SKILL\.md:3\) and playwright \(global, ~\/\.claude\/skills\/playwright\/SKILL\.md:3\) have overlapping descriptions$/);
  assert.deepEqual(snapshot(home, dir), before, 'nothing is written');
  assert.ok(!JSON.stringify(found).includes(SECRET), 'the text of the user\'s files stays out of the report');
});

test('global instruction files and plugin skills', () => {
  const { ctx, home } = machine();
  put(join(home, '.claude/CLAUDE.md'), '@rules/gone.md\n');
  put(join(home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'p@m': true, 'off@m': true } }));
  const plugin = (name) => join(home, '.claude/plugins/cache/m', name, '1.0.0');
  skill(join(plugin('p'), 'skills'), 'ship', 'Release notes and changelog entries');
  skill(join(plugin('off'), 'skills'), 'ship-off', 'Release notes and changelog entries');
  put(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'p@m': [{ scope: 'user', installPath: plugin('p') }], 'off@m': [{ scope: 'user', installPath: '/etc' }] } }));
  skill(join(home, '.claude/skills'), 'changes', 'Release notes changelog');
  const found = doctor(ctx, { agents: [], env: {} });
  assert.deepEqual(only(found, 'instructions').map((i) => `${i.file}:${i.line}`), [`${tilde('.claude/CLAUDE.md')}:1`]);
  assert.equal(only(found, 'skills').length, 1);
  assert.match(only(found, 'skills')[0].message, /^changes \(global, ~\/\.claude\/skills\/changes\/SKILL\.md:3\) and ship \(plugin p, ~\/\.claude\/plugins\/cache\/m\/p\/1\.0\.0\/skills\/ship\/SKILL\.md:3\) have/);
});

test('classify: broad rules, safe rules and rules written as prose', () => {
  const level = (r) => classify(r)?.level ?? null;
  assert.deepEqual(['Bash', 'Bash(*)', 'Bash(python *)', 'Bash(node:*)', 'Bash(python3.12 *)', 'Bash(bash -c *)', 'Bash(* --help)', 'Edit', 'Bash(git * main)'].map(level), ['warning', 'warning', 'warning', 'warning', 'warning', 'warning', 'warning', 'info', 'info']);
  for (const safe of ['Bash(npm run test *)', 'Bash(git log *)', 'Bash(python scripts/check.py)', 'Bash(python -m pytest *)', 'Bash(node --test *)', 'Bash(npx prettier *)', 'Bash(node scripts/*.mjs)', 'Read', 'WebSearch', 'mcp__server__tool', 'Edit(src/**)', 'WebFetch(domain:example.com)', '$defaults', 'Trusted repo: the working one', 42]) assert.equal(classify(safe), null, String(safe));
});

test('codex rules: allow of a shell or interpreter only', () => {
  const text = ['# prefix_rule(pattern = ["bash"])', 'prefix_rule(pattern = ["git", "status"])', 'prefix_rule(', '  pattern = ["python", "-c"],', '  justification = "x",', ')', 'prefix_rule(pattern = ["sh"], decision = "prompt")', 'prefix_rule(pattern = [["node", "deno"], "-e"], decision = "allow")', 'prefix_rule(pattern = ["node", "scripts/build.mjs"])', 'prefix_rule(pattern = ["sh", "-c", "echo #1"])'].join('\n');
  assert.deepEqual(codexAllows(text).map((r) => [r.line, r.rule]), [[3, 'pattern = ["python", "-c"]'], [8, 'pattern = [["node", "deno"], "-e"]']]);
});

test('allow rules: user, project and local files and Codex rules, with the registered repositories that carry them', () => {
  const { ctx, home, dir } = machine();
  const other = mkdtempSync(join(TMP, 'bk-lint-other-'));
  put(join(home, '.claude/settings.json'), JSON.stringify({ permissions: { allow: ['Bash(*)', 'Bash(npm run test *)', 'Bash(python *)', `Bash(* --header "token: ${SECRET}")`] } }));
  put(join(dir, '.claude/settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(python *)', `Bash(curl -H "token: ${SECRET}" *)`] } }));
  put(join(other, '.claude/settings.json'), JSON.stringify({ permissions: { allow: ['Bash(python *)'] } }));
  put(join(dir, '.codex/rules/default.rules'), 'prefix_rule(pattern = ["bash", "-lc"])\n');
  addProject(ctx, dir);
  addProject(ctx, other);
  const before = snapshot(home, dir, other);
  const user = allowChecks(ctx);
  assert.deepEqual(user.slice(0, 2).map((i) => [i.level, i.scope, i.file, i.rule, i.repos]), [['warning', 'user', tilde('.claude/settings.json'), 'Bash(*)', 0], ['warning', 'user', tilde('.claude/settings.json'), 'Bash(python *)', 2]]);
  assert.equal(user.length, 3, 'a rule that holds a secret is reported, its value masked');
  const project = allowChecks(ctx, { dir });
  assert.deepEqual(project.map((i) => [i.scope, i.file, i.rule, i.repos]), [['local', '.claude/settings.local.json', 'Bash(python *)', 2], ['project', '.codex/rules/default.rules', 'pattern = ["bash", "-lc"]', 1]]);
  assert.match(project[0].message, /^Claude Code allows Bash\(python \*\) \(local, \.claude\/settings\.local\.json\): python runs any code; 2 registered repositories carry it$/);
  assert.ok(project.every((i) => /^information only, nothing is changed/.test(i.fix) && !/\bask\b/.test(i.fix)));
  assert.deepEqual(allowChecks(ctx, { agents: ['codex'] }), []);
  assert.deepEqual(snapshot(home, dir, other), before, 'no settings file changes');
  assert.ok(!JSON.stringify([user, project]).includes(SECRET));
});

test('allow rules: safe rules and no setting give no finding', () => {
  const { ctx, home, dir } = machine();
  assert.deepEqual(only(doctor(ctx, { agents: ['claude', 'codex'], dir, env: {} }), 'allow-rules'), []);
  put(join(home, '.claude/settings.json'), JSON.stringify({ permissions: { allow: ['Bash(npm run test *)'], deny: ['Bash'] } }));
  assert.deepEqual(allowChecks(ctx), []);
});

test('a project with only skills or settings is checked, and its project-scoped plugins count', () => {
  const { ctx, home, dir } = machine();
  skill(join(dir, '.claude/skills'), 'browser-tests', 'Writing Playwright browser tests');
  const plugin = join(home, '.claude/plugins/cache/m/p/1.0.0');
  skill(join(plugin, 'skills'), 'playwright', 'Playwright browser tests');
  put(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'p@m': [{ scope: 'project', projectPath: dir, installPath: plugin }] } }));
  assert.deepEqual(only(doctor(ctx, { agents: [], dir, env: {} }), 'skills'), [], 'not enabled for the project');
  put(join(dir, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'p@m': true } }));
  const found = only(doctor(ctx, { agents: [], dir, env: {} }), 'skills');
  assert.equal(found.length, 1);
  assert.match(found[0].message, /browser-tests \(project, .*and playwright \(plugin p, /);
});

test('a plugin installed for the project is compared with the global skills', () => {
  const { ctx, home, dir } = machine();
  const plugin = join(home, '.claude/plugins/cache/m/p/1.0.0');
  skill(join(plugin, 'skills'), 'playwright', 'Playwright browser tests');
  skill(join(home, '.claude/skills'), 'browsers', 'Playwright browser tests runner');
  put(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'p@m': [{ scope: 'local', projectPath: dir, installPath: plugin }] } }));
  put(join(dir, '.claude/settings.local.json'), JSON.stringify({ enabledPlugins: { 'p@m': true } }));
  assert.equal(only(doctor(ctx, { agents: [], dir, env: {} }), 'skills').length, 1);
  assert.equal(only(doctor(ctx, { agents: [], env: {} }), 'skills').length, 0, 'the global check does not see it');
});
