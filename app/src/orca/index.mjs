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

// Its CLI: `orca` is on the PATH only in the terminals it opens; on Linux it registers `orca-ide`, and the shim in its config
// folder execs that. The first that answers --version is used for every call, found once per context; a miss is asked
// again, so one installed while the app runs is seen.
const NAMES = ['orca', 'orca-ide'];
const SHIM = ['.config', 'orca', 'linux-orca-cli-shim', 'orca'];
const tried = (ctx) => [...NAMES, join(ctx.home, ...SHIM)];
const found = new WeakMap();
function probe(ctx) {
  if (found.has(ctx)) return found.get(ctx);
  for (const bin of tried(ctx)) {
    const r = ctx.run([bin, '--version']);
    if (r.code === 0) { found.set(ctx, { bin, version: String(r.stdout) }); return found.get(ctx); }
  }
  return null;
}
// Not found: the first name, so a call fails the way a missing program does.
export const bin = (ctx) => probe(ctx)?.bin ?? NAMES[0];
export const installed = (ctx) => probe(ctx) !== null;
export const notInstalled = (ctx) => `${NAME} is not installed: none of ${tried(ctx).join(', ')} answered --version; put orca-ide on the PATH`;
// The version the adapter and its recorded test fixtures were observed with. On another major version the owner runs the
// manual checks first; doctor warns until then. Unknown output is no warning.
export const OBSERVED = '1.4.245';
const major = (v) => /^\s*v?(\d+)\.\d+/.exec(v)?.[1] ?? null;
export function unobserved(ctx) {
  const v = probe(ctx)?.version;
  const seen = v ? major(v) : null;
  if (!seen || seen === major(OBSERVED)) return null;
  return { message: `${NAME} ${v.trim()} is a major version this app was not checked with (${OBSERVED})`, fix: `update benchkeeper; until a release names this version, its ${NAME} runs view may miss runs (checklist: docs/orca-checks.md in the BenchKeeper repository)` };
}
// Its hooks carry its environment variables in the command; the agent settings files get them written back.
export const ownsHook = (command) => /ORCA_/.test(String(command ?? ''));

// The worker spec and the per-worktree setup samples, in the app's config folder, never in a project.
export const templates = (ctx) => FILES.map((f) => ({
  step: 'orca:templates', title: `${NAME} worker spec and setup samples (optional): ${f}`,
  change: { kind: 'write', path: join(ctx.config, 'orca', f), after: readFileSync(new URL(f, import.meta.url), 'utf8') },
}));

// The per-worktree setup file project setup offers when workers ran in the project's worktrees: the setup script runs
// install (null: a line to fill in) before the agent starts, and the archive script removes the worktree's dev containers.
// The local files each new worktree copies are in .worktreeinclude, which project setup writes for every worktree tool.
export const worktreeFile = (install) => ({ path: 'orca.yaml', text: `# ${NAME} runs the setup script in each new worktree when its setup run policy allows it, then starts the agent; the archive script runs before it removes a worktree with --run-hooks.\nscripts:\n  setup: |\n    cd "$ORCA_WORKTREE_PATH"\n    ${install ?? '# the install command from AGENTS.md, for example: npm ci'}\n  archive: |\n    # Before the worktree is removed: stop and remove its dev containers (volumes stay); a failure never blocks the removal.\n    sh -c 'e=$(command -v podman || command -v docker) && [ -n "$ORCA_WORKTREE_PATH" ] && "$e" ps -aq --filter "label=devcontainer.local_folder=$ORCA_WORKTREE_PATH" | xargs -r "$e" rm -f >/dev/null; exit 0'\nsetupAgentStartupPolicy: wait-for-setup\n` });
// The .worktreeinclude project setup offered with orca.yaml before it kept a block there: all of it BenchKeeper's.
export const offeredInclude = (text) => typeof text === 'string' && text.startsWith(`# Local files ${NAME} copies into each new worktree when they exist and Git ignores them.\n`);

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
  const r = await run([bin(ctx), 'orchestration', ...args, '--json'], { timeout: 15e3 });
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
const AUTO = (ctx) => [bin(ctx), 'automations'];
const AUTO_ID = /^[\w-]{1,128}$/;
// Orca's grace when create gets none; it refuses 0, so a template's 0 (the runner's default) is this on an edit.
const DEFAULT_GRACE = 720;
// The fields an update may change; the target (project folder, worktree mode) stays as created. A create leaves an empty
// precheck and a grace of 0 out; an edit changes only the flags it gets, so it sets both ("" clears the precheck).
const fields = (f, edit = false) => ['--name', f.name, '--trigger', f.schedule, '--prompt', f.prompt, '--provider', f.agent,
  ...(f.precheck || edit ? ['--precheck', f.precheck ?? ''] : []),
  ...(f.grace > 0 || edit ? ['--missed-run-grace-minutes', String(f.grace > 0 ? f.grace : DEFAULT_GRACE)] : []),
  ...(f.workspace === 'project' ? [f.reuseSession ? '--reuse-session' : '--fresh-session'] : [])];
// An explicit target: without one the CLI binds the automation to the worktree its working folder lies in.
const target = (f) => (f.workspace === 'project' ? ['--workspace', `path:${f.dir}`] : ['--repo', `path:${f.dir}`, '--workspace-mode', 'new-per-run']);
export const createArgv = (ctx, f) => [...AUTO(ctx), 'create', ...fields(f), ...target(f), '--disabled', '--json'];
export const editArgv = (ctx, id, f) => [...AUTO(ctx), 'edit', '--id', id, ...fields(f, true), '--json'];
export const removeArgv = (ctx, id) => [...AUTO(ctx), 'remove', '--id', id, '--json'];
// The undo commands an automation change plans: remove by id, or edit by id with the fields above. A ledger file that
// names anything else is not run. Any of the CLI's names: the context that recorded it may have found another one.
const EDIT_FLAGS = new Set(['--name', '--trigger', '--prompt', '--provider', '--precheck', '--missed-run-grace-minutes']);
export function undoableAutomation(argv, ctx) {
  if (!Array.isArray(argv) || !(ctx ? tried(ctx) : NAMES).includes(argv[0]) || argv[1] !== 'automations' || argv[3] !== '--id' || !AUTO_ID.test(argv[4] ?? '') || argv.at(-1) !== '--json') return false;
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
export const showAutomation = (ctx, id) => automationResult(ctx.run([...AUTO(ctx), 'show', '--id', id, '--json'], { timeout: 15e3 }));
// The runner name a registry record carries.
export const RUNNER = 'orca';
// Its run history of one automation, newest first: { runs: [{ status, trigger, at }] } or { error }. Status, trigger and the
// due time are picked; a run's title, output and error text stay out.
export const runsArgv = (ctx, id, limit = 20) => [...AUTO(ctx), 'runs', '--id', id, '--limit', String(limit), '--json'];
export function automationRuns(ctx, id) {
  const r = ctx.run(runsArgv(ctx, id), { timeout: 15e3 });
  let j = null;
  try { j = JSON.parse(r.stdout); } catch { /* not JSON: the message below */ }
  if (r.code !== 0 || !j?.ok || !Array.isArray(j.result?.runs)) return { error: `${NAME}: ${j?.error?.message ?? (String(r.stderr || r.stdout).trim().split('\n').at(-1) || `exit ${r.code}`)}` };
  const at = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
  return { runs: j.result.runs.map((x) => ({ status: String(x.status ?? ''), trigger: String(x.trigger ?? ''), at: at(x.scheduledFor ?? x.startedAt) })) };
}
