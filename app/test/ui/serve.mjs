// Playwright's web server: the UI server with a fixture home and stubbed agent commands, never the real machine.
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addProject } from '../../src/projects.mjs';
import { apply, context, preview } from '../../src/runner.mjs';
import { startServer } from '../../src/server.mjs';
import { globalPlan } from '../../src/steps/global.mjs';
import { projectPlan } from '../../src/steps/project.mjs';

export const PORT = 4410;
export const TOKEN = 'ui-test-token-0123456789';

const home = mkdtempSync(join(tmpdir(), 'bk-ui-'));
const run = (argv, o = {}) => {
  if (argv[0] === 'git') { try { return { code: 0, stdout: execFileSync('git', argv.slice(1), { cwd: o.cwd, encoding: 'utf8', stdio: 'pipe' }), stderr: '' }; } catch (e) { return { code: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }; } }
  if (argv[0] === 'claude' && argv[1] === '--version') return { code: 0, stdout: '2.1.0 (Claude Code)\n', stderr: '' };
  if (argv[0] === 'claude') return { code: 0, stdout: argv.includes('--json') ? '[]' : '', stderr: '' };
  return { code: 127, stdout: '', stderr: 'not installed' };
};
const ctx = context({ home, run, appVersion: '6.0.0' });
apply(preview(globalPlan({ ctx, agents: ['claude'], devcontainerCli: '1.0.0' })), ctx, { select: [] });
const first = preview(globalPlan({ ctx, agents: ['claude'], devcontainerCli: '1.0.0' })).filter((c) => c.kind === 'write');
apply(first, ctx);
appendFileSync(join(home, '.claude/rules/00-global.md'), 'a local line\n');
const dir = mkdtempSync(join(tmpdir(), 'bk-ui-proj-'));
execFileSync('git', ['init', '-q', '-b', 'main', dir]);
writeFileSync(join(dir, 'README.md'), '# Demo\n');
const pctx = { ...ctx, roots: [dir] };
apply(preview(projectPlan({ ctx: pctx, dir, answers: { agents: ['claude'], env: 'host-agent', packs: ['frontend'], tier: 'quick' } }).changes).filter((c) => c.kind !== 'command'), pctx, { scope: dir });
addProject(ctx, dir);

await startServer(ctx, { port: PORT, token: TOKEN });
console.log(`ready http://127.0.0.1:${PORT}/`);
