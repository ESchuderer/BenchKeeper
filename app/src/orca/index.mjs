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

// The text in a dispatched worker's first prompt: two lines, both needed, so a prompt that quotes one is no worker. A user's
// own words can come before it. Observed in transcripts, not documented: a changed wording reads as no worker.
const PREAMBLE = [/^You are working inside Orca, a multi-agent IDE\./m, /^Your task ID is: \S+/m];
export const isWorkerPrompt = (text) => PREAMBLE.every((r) => r.test(text));
// The line the worker-spec template carries: its value joins a coordinator's workers.
export const runOf = (text) => text.match(/^Orca run: ([\w.-]{1,64})[ \t]*$/m)?.[1] ?? null;
