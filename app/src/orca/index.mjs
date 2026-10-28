// Everything the app knows about Orca, the multi-agent IDE: whether it is installed, its hooks, its skills, the sample files offered
// with it and the sessions it dispatched. The import rules keep the name out of the rest of src/.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const NAME = 'Orca';
// The `pattern` of a session that a dispatched worker ran.
export const WORKER_PATTERN = `${NAME} worker`;
export const SKILL_SOURCE = 'https://github.com/stablyai/orca';
export const SKILLS = ['orca-cli', 'orchestration'];
const FILES = ['worker-spec.md', 'orca.yaml.sample', 'worktreeinclude.sample'];

export const installed = (ctx) => ctx.run(['orca', '--version']).code === 0;
// The version the adapter and its recorded test fixtures were observed with. On another major version the owner runs the
// manual checks first; doctor warns until then. Unknown output is no warning.
export const OBSERVED = '1.4.243';
const major = (v) => /^\s*v?(\d+)\.\d+/.exec(v)?.[1] ?? null;
export function unobserved(ctx) {
  const r = ctx.run(['orca', '--version']);
  const seen = r.code === 0 ? major(String(r.stdout)) : null;
  if (!seen || seen === major(OBSERVED)) return null;
  return { message: `${NAME} ${String(r.stdout).trim()} is a major version this app was not checked with (${OBSERVED})`, fix: `update benchkeeper; until a release names this version, its ${NAME} runs view may miss runs (checklist: docs/orca-checks.md in the BenchKeeper repository)` };
}
// Its hooks carry its environment variables in the command; the agent settings files get them written back.
export const ownsHook = (command) => /ORCA_/.test(String(command ?? ''));

// The worker spec and the per-worktree setup samples, in the app's config folder, never in a project.
export const templates = (ctx) => FILES.map((f) => ({
  step: 'orca:templates', title: `${NAME} worker spec and setup samples (optional): ${f}`,
  change: { kind: 'write', path: join(ctx.config, 'orca', f), after: readFileSync(new URL(f, import.meta.url), 'utf8') },
}));

// The per-worktree setup files project setup offers when workers ran in the project's worktrees: the setup script runs
// install (null: a line to fill in) before the agent starts, and the local files listed are copied into each new worktree.
export const worktreeFiles = (install, include) => [
  { path: 'orca.yaml', text: `# ${NAME} runs the setup script in each new worktree when its setup run policy allows it, then starts the agent.\nscripts:\n  setup: |\n    cd "$ORCA_WORKTREE_PATH"\n    ${install ?? '# the install command from AGENTS.md, for example: npm ci'}\nsetupAgentStartupPolicy: wait-for-setup\n` },
  { path: '.worktreeinclude', text: `# Local files ${NAME} copies into each new worktree when they exist and Git ignores them.\n${include.join('\n')}\n` },
];

// The text in a dispatched worker's first prompt: two lines, both needed, so a prompt that quotes one is no worker. A user's
// own words can come before it. Observed in transcripts, not documented: a changed wording reads as no worker.
const PREAMBLE = [/^You are working inside Orca, a multi-agent IDE\./m, /^Your task ID is: \S+/m];
export const isWorkerPrompt = (text) => PREAMBLE.every((r) => r.test(text));
// The line the worker-spec template carries: its value joins a coordinator's workers.
export const runOf = (text) => text.match(/^Orca run: ([\w.-]{1,64})[ \t]*$/m)?.[1] ?? null;
// The task id of the preamble, only in a worker prompt.
export const taskOf = (text) => (isWorkerPrompt(text) ? text.match(/^Your task ID is: ([\w.-]{1,64})[ \t]*$/m)?.[1] ?? null : null);

// Its runs and their tasks, read when the runs view asks: ids, states and counts only. A task's spec, title and result hold
// the coordinator's and the worker's text, so the fields are picked, never spread. null when it is not installed or fails.
const cli = async (ctx, args) => {
  const run = ctx.runAsync ?? (async (argv, o) => ctx.run(argv, o));
  const r = await run(['orca', 'orchestration', ...args, '--json'], { timeout: 15e3 });
  try { const j = r.code === 0 ? JSON.parse(r.stdout) : null; return j?.ok ? j.result : null; } catch { return null; }
};
export async function runs(ctx, limit = 20) {
  const list = await cli(ctx, ['run-list', '--limit', String(limit)]);
  if (!Array.isArray(list?.runs)) return null;
  const out = [];
  for (const r of list.runs.slice(0, limit)) {
    const tasks = (await cli(ctx, ['task-list', '--run', String(r.id)]))?.tasks;
    const states = {};
    for (const t of Array.isArray(tasks) ? tasks : []) states[String(t.status)] = (states[String(t.status)] ?? 0) + 1;
    out.push({ id: String(r.id), created: r.created_at ?? null, updated: r.updated_at ?? null, tasks: Array.isArray(tasks) ? tasks.length : null, states });
  }
  return out;
}

// ---- scheduled automations: create, edit, remove and show through its CLI (help of OBSERVED; the JSON shapes are read
// from its source of that version). f is { name, schedule, prompt, agent, precheck, workspace, dir, reuseSession, grace }.
const AUTO = ['orca', 'automations'];
const AUTO_ID = /^[\w-]{1,128}$/;
// The fields an update may change; the target (project folder, worktree mode) stays as created.
const fields = (f) => ['--name', f.name, '--trigger', f.schedule, '--prompt', f.prompt, '--provider', f.agent,
  ...(f.precheck ? ['--precheck', f.precheck] : []), ...(f.grace > 0 ? ['--missed-run-grace-minutes', String(f.grace)] : []),
  ...(f.workspace === 'project' ? [f.reuseSession ? '--reuse-session' : '--fresh-session'] : [])];
// An explicit target: without one the CLI binds the automation to the worktree its working folder lies in.
const target = (f) => (f.workspace === 'project' ? ['--workspace', `path:${f.dir}`] : ['--repo', `path:${f.dir}`, '--workspace-mode', 'new-per-run']);
export const createArgv = (f) => [...AUTO, 'create', ...fields(f), ...target(f), '--disabled', '--json'];
export const editArgv = (id, f) => [...AUTO, 'edit', '--id', id, ...fields(f), '--json'];
export const removeArgv = (id) => [...AUTO, 'remove', '--id', id, '--json'];
// The undo commands an automation change plans: remove by id, or edit by id with the fields above. A ledger file that
// names anything else is not run.
const EDIT_FLAGS = new Set(['--name', '--trigger', '--prompt', '--provider', '--precheck', '--missed-run-grace-minutes']);
export function undoableAutomation(argv) {
  if (!Array.isArray(argv) || argv[0] !== AUTO[0] || argv[1] !== AUTO[1] || argv[3] !== '--id' || !AUTO_ID.test(argv[4] ?? '') || argv.at(-1) !== '--json') return false;
  const rest = argv.slice(5, -1);
  if (argv[2] === 'remove') return rest.length === 0;
  if (argv[2] !== 'edit') return false;
  for (let i = 0; i < rest.length; i += 1) {
    if (['--reuse-session', '--fresh-session'].includes(rest[i])) continue;
    if (!EDIT_FLAGS.has(rest[i]) || typeof rest[i + 1] !== 'string') return false;
    i += 1;
  }
  return true;
}

// The fields BenchKeeper compares, picked from its automation record: never spread, it carries host and account context.
const picked = (a) => ({ id: String(a.id), name: String(a.name ?? ''), prompt: String(a.prompt ?? ''), schedule: String(a.rrule ?? ''),
  precheck: String(a.precheck?.command ?? ''), agent: String(a.agentId ?? ''), enabled: a.enabled === true });
// The result of a create, edit or show: { automation } on success, else { error } (removed: true when it is not found).
export function automationResult(r) {
  let j = null;
  try { j = JSON.parse(r.stdout); } catch { /* not JSON: the message below */ }
  if (r.code === 0 && j?.ok && j.result?.automation?.id) return { automation: picked(j.result.automation) };
  const message = j?.error?.message ?? (String(r.stderr || r.stdout).trim().split('\n').at(-1) || `exit ${r.code}`);
  return { error: `${NAME}: ${message}`, ...(/not found/i.test(message) ? { removed: true } : {}) };
}
export const showAutomation = (ctx, id) => automationResult(ctx.run([...AUTO, 'show', '--id', id, '--json'], { timeout: 15e3 }));
// The runner name a registry record carries.
export const RUNNER = 'orca';
