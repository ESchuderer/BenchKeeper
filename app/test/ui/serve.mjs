// Playwright's web server: the UI server with a fixture home and stubbed agent commands, never the real machine.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { addProject } from '../../src/projects.mjs';
import { apply, context, preview } from '../../src/runner.mjs';
import { startServer } from '../../src/server.mjs';
import { SKILLS_SPEC, globalPlan } from '../../src/steps/global.mjs';
import { projectPlan } from '../../src/steps/project.mjs';
import { writeSessions } from '../fixtures/sessions.mjs';

export const PORT = 4410;
export const TOKEN = 'ui-test-token-0123456789';
// Two more repositories for Prefill all, registered by the test: alpha has a GitHub origin, broken gets no suggestion.
export const BATCH = join(tmpdir(), `bk-ui-batch-${PORT}`);

// Demo mode (app/scripts/screenshots.mjs, the site's screenshots): fixed folder names under one fixture root, and the
// server must run with HOME inside it.
const DEMO = process.env.BK_DEMO_ROOT;
const home = DEMO ? join(DEMO, 'home') : mkdtempSync(join(tmpdir(), 'bk-ui-'));
if (DEMO && resolve(process.env.HOME ?? '') !== resolve(home)) throw new Error(`demo mode needs HOME=${home}, not the caller's home`);
mkdirSync(home, { recursive: true });
// The folder dialog answers with a parent of the registered project and of one more folder with an agent setup.
const parent = DEMO ? join(DEMO, 'projects') : mkdtempSync(join(tmpdir(), 'bk-ui-scan-'));
const other = DEMO ? 'blog' : 'other';
mkdirSync(join(parent, other), { recursive: true });
writeFileSync(join(parent, `${other}/AGENTS.md`), '# Other\n');
// A repository without a state file, for the step-by-step first setup.
for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 't@example.com'], ['config', 'user.name', 't'], ['add', '-A'], ['commit', '-qm', 'init']]) execFileSync('git', ['-C', join(parent, other), ...a]);
// Four more for the one-run setup, registered by the tests: uno has a local setup with a file missing (behind), the
// others have none. A suggestion for duo or quatro waits while GATE exists, so a test can look at the progress page.
export const ONE = join(tmpdir(), `bk-ui-one-${PORT}`);
export const GATE = join(tmpdir(), `bk-ui-gate-${PORT}`);
rmSync(ONE, { recursive: true, force: true });
rmSync(GATE, { force: true });
for (const name of ['uno', 'duo', 'tres', 'quatro']) {
  const d = join(ONE, name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'README.md'), `# ${name}\n`);
  for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 't@example.com'], ['config', 'user.name', 't'], ['add', '-A'], ['commit', '-qm', 'init']]) execFileSync('git', ['-C', d, ...a]);
}
rmSync(BATCH, { recursive: true, force: true });
for (const name of ['alpha', 'broken']) {
  const d = join(BATCH, name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'README.md'), `# ${name}\n`);
  for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 't@example.com'], ['config', 'user.name', 't'], ['add', '-A'], ['commit', '-qm', 'init']]) execFileSync('git', ['-C', d, ...a]);
}
execFileSync('git', ['-C', join(BATCH, 'alpha'), 'remote', 'add', 'origin', 'https://github.com/acme/alpha.git']);
const run = (argv, o = {}) => {
  // GitHub is never reached: fetch answers with the local default branch as origin's, push and ls-remote answer as an empty remote, gh opens a pull request.
  // The fetch becomes a ref update in the same repository, so origin/<branch> exists as after a real fetch.
  if (argv[0] === 'git' && argv.includes('fetch')) argv = [...argv.slice(0, argv.indexOf('fetch')), 'update-ref', `refs/remotes/origin/${argv.at(-1)}`, 'HEAD'];
  if (argv[0] === 'git' && (argv.includes('push') || argv.includes('ls-remote'))) return { code: 0, stdout: '', stderr: '' };
  if (argv[0] === 'gh' && argv[1] === 'pr' && argv[2] === 'create') return { code: 0, stdout: 'https://github.com/acme/alpha/pull/1\n', stderr: '' };
  if (argv[0] === 'git') { try { return { code: 0, stdout: execFileSync('git', argv.slice(1), { cwd: o.cwd, encoding: 'utf8', stdio: 'pipe' }), stderr: '' }; } catch (e) { return { code: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }; } }
  // The skills CLI adds a skill folder with one file: in a rehearsal's scratch home, else in the fixture home, never the real one.
  if (argv[0] === 'npx' && argv[2] === SKILLS_SPEC) {
    const name = argv.includes('-s') ? argv[argv.indexOf('-s') + 1] : argv[4];
    const base = argv.includes('-g') ? (o.env?.HOME?.includes('bk-prerun-') ? o.env.HOME : home) : o.cwd;
    const at = join(base, '.claude/skills', name);
    if (argv[3] === 'add') { mkdirSync(at, { recursive: true }); writeFileSync(join(at, 'SKILL.md'), `---\nname: ${name}\n---\n`); } else rmSync(at, { recursive: true, force: true });
    return { code: 0, stdout: '', stderr: '' };
  }
  if (argv[0] === 'zenity') return { code: 0, stdout: `${parent}\n`, stderr: '' };
  if (argv[0] === 'claude' && argv[1] === '--version') return { code: 0, stdout: '2.1.0 (Claude Code)\n', stderr: '' };
  // Setup advice: a restricted read-only session answers with one library skill.
  if (argv[0] === 'claude' && argv.includes('--restricted') && o.cwd?.endsWith('/broken')) return { code: 1, stdout: '', stderr: 'model overloaded' };
  if (argv[0] === 'claude' && argv.includes('--restricted')) return { code: 0, stdout: JSON.stringify({ result: JSON.stringify({ skills: [{ name: 'designing-technical-uis', reason: 'the project has a UI' }] }) }), stderr: '' };
  if (argv[0] === 'claude') return { code: 0, stdout: argv.includes('--json') ? '[]' : '', stderr: '' };
  return { code: 127, stdout: '', stderr: 'not installed' };
};
const ctx = context({ home, run, appVersion: '6.0.0' });
ctx.runAsync = async (argv, o) => {
  if (argv.includes('--restricted') && /[\\/](duo|quatro)$/.test(o.cwd ?? '')) for (let i = 0; i < 400 && existsSync(GATE); i++) await new Promise((r) => setTimeout(r, 50));
  return run(argv, o);
};
const first = preview(globalPlan({ ctx, agents: ['claude'], devcontainerCli: '1.0.0' })).filter((c) => c.kind === 'write');
apply(first, ctx);
appendFileSync(join(home, '.claude/rules/00-global.md'), 'a local line\n');
const dir = join(parent, DEMO ? 'shop' : 'bk-ui-proj');
execFileSync('git', ['init', '-q', '-b', 'main', dir]);
writeFileSync(join(dir, 'README.md'), '# Demo\n');
const pctx = { ...ctx, roots: [dir] };
apply(preview(projectPlan({ ctx: pctx, dir, answers: { agents: ['claude'], env: 'host-agent', packs: ['frontend'], tier: 'quick', share: true } }).changes).filter((c) => c.kind !== 'command'), pctx, { scope: dir });
addProject(ctx, dir);
{
  const uno = join(ONE, 'uno'), uctx = { ...ctx, roots: [uno] };
  apply(preview(projectPlan({ ctx: uctx, dir: uno, answers: { agents: ['claude'], env: 'host', tier: 'quick' } }).changes).filter((c) => c.kind !== 'command'), uctx, { scope: uno });
  rmSync(join(uno, 'CLAUDE.local.md'));
}
if (DEMO) addProject(ctx, join(parent, other));
// Two eval runs of one skill for the Evals chart.
mkdirSync(join(ctx.config, 'evals'), { recursive: true });
// Two agents, three targets; a rule target has no rates, and Codex's workflow run had no should-not cases.
const result = (time, missRate, falseTriggerRate, target = 'skill:designing-technical-uis', agent = 'claude') => ({ time, target, agent, agentVersion: agent === 'claude' ? '2.1.0' : '0.50.0', model: null, hash: 'x', appVersion: '6.0.0', cases: 6, missRate, falseTriggerRate, details: [] });
writeFileSync(join(ctx.config, 'evals/results.jsonl'), [result('2026-10-01T10:00:00Z', 0.5, 0), result('2026-10-08T10:00:00Z', 0.25, 0.33),
  result('2026-10-08T11:00:00Z', 0, 0.17, 'skill:workflow'), result('2026-10-08T12:00:00Z', null, null, 'rule:global'),
  result('2026-10-09T10:00:00Z', 0.33, null, 'skill:workflow', 'codex')].map((r) => JSON.stringify(r)).join('\n') + '\n');

// Claude Code and Codex transcripts for the Sessions board.
if (DEMO) writeSessions(home, { root: parent, title: 'Fix the cart total' });
else writeSessions(home);

// The agents are stubs, so the eval plan may show in CI too.
delete process.env.CI;
// The folder dialog needs a display; the stubbed zenity answers without one.
process.env.DISPLAY ??= ':99';
await startServer(ctx, { port: PORT, token: TOKEN });
console.log(`ready http://127.0.0.1:${PORT}/`);
