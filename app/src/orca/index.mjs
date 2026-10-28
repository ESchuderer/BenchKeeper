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
