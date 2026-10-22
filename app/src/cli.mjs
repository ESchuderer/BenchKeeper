// Command line: every UI action is also a command here.
import { createInterface } from 'node:readline/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { detect } from './agents.mjs';
import { appVersion } from './content.mjs';
import { apply, context, legacyBackups, preview, restoreLegacy, undo } from './runner.mjs';
import { addProject, listProjects, removeProject, scan, status, updateAll } from './projects.mjs';
import { recordSession } from './session.mjs';
import { globalPlan } from './steps/global.mjs';
import { projectPlan } from './steps/project.mjs';

export const HELP = `benchkeeper ${appVersion}: installs, updates and undoes the BenchKeeper agent setup.

Usage: benchkeeper <command> [options]

  ui [--no-open] [--port N]         local web UI (default command)
  plan [--agents a,b] [--pack p]    global setup: the changes, with a diff each, nothing written
  apply [--agents a,b] [--pack p] [--yes] [--all]
                                    global setup: asks per change; --yes takes the default selection,
                                    --all also the removals
  history                           runs, newest first
  undo <run> [--step <step>]        restores the files of a run or one of its steps
  restore <name>                    restores a setup.sh backup (~/.config/benchkeeper/backup/<name>)
  project plan|apply [dir] [--agents a,b] [--env e] [--sandbox] [--pack p] [--skill s] [--tier t] [--yes]
                                    project setup; answers default to the project's .benchkeeper/state.json
  projects [list|add <dir>..|scan <root>|remove <dir>]
                                    projects Update all covers (~/.config/benchkeeper/projects.json)
  update-all [--yes] [--no-push]    per project: branch chore/agent-setup-<version> in a worktree, one commit,
                                    push and pull request when origin is on GitHub
  record [--project dir] -- <agent> [args]
                                    runs an agent session and records the files it changes (undo restores them)

Agents: claude, codex, gemini, copilot (default: the installed ones). Packs: see plugins/benchkeeper/library/README.md.
Env (where the agent runs): container (default), host-agent, sandbox, host. Tier: quick, standard, full, research.`;

const OPTIONS = {
  agents: { type: 'string' }, pack: { type: 'string', multiple: true }, yes: { type: 'boolean' }, all: { type: 'boolean' },
  step: { type: 'string' }, 'no-open': { type: 'boolean' }, port: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  env: { type: 'string' }, sandbox: { type: 'boolean' }, skill: { type: 'string', multiple: true }, tier: { type: 'string' }, project: { type: 'string' },
  'no-push': { type: 'boolean' },
};

export function installedPlugins(ctx) {
  const parse = (t, f) => { try { return JSON.parse(t); } catch { return f; } };
  return {
    claude: parse(ctx.run(['claude', 'plugin', 'list', '--json']).stdout, []).filter((p) => p.enabled).map((p) => p.id),
    codex: (parse(ctx.run(['codex', 'plugin', 'list', '--json']).stdout, {}).installed ?? []).filter((p) => p.enabled).map((p) => p.pluginId),
  };
}

async function confirm(question, input, out) {
  out.write(`${question} [y/N] `);
  const rl = createInterface({ input, terminal: false });
  const { value = '' } = await rl[Symbol.asyncIterator]().next();
  rl.close();
  return /^y$/i.test(value.trim());
}

async function choose(plan, o, input, out) {
  if (o.yes || o.all) return plan.filter((c) => !c.error && (o.all || c.selected)).map((c) => c.id);
  // Lines, not rl.question: piped answers that end early count as no.
  const rl = createInterface({ input, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  const select = [];
  for (const c of plan) {
    show(c, out);
    if (c.error) continue;
    out.write('apply? [y/N] ');
    const { value = '' } = await lines.next();
    if (/^y$/i.test(value.trim())) select.push(c.id);
  }
  rl.close();
  return select;
}

function report(run, out) {
  for (const e of run.entries) out.write(`${e.status.padEnd(7)} ${e.title}${e.error || e.reason ? `: ${e.error ?? e.reason}` : ''}\n`);
  if (run.kind !== 'undo') out.write(`run ${run.id}: undo with benchkeeper undo ${run.id}\n`);
  return run.status === 'done' ? 0 : 1;
}

export function machineContext(env = process.env) {
  const home = env.BENCHKEEPER_HOME ?? homedir();
  return context({ home, appVersion });
}

export function selectedAgents(ctx, list) {
  if (list) return list.split(',').map((s) => s.trim()).filter(Boolean);
  return detect(ctx).filter((a) => a.installed).map((a) => a.id);
}

function show(c, out) {
  out.write(`${c.destructive ? 'remove ' : 'change '}${c.title}${c.error ? `\n  cannot merge: ${c.error}` : ''}\n`);
  if (c.kind === 'command') out.write(`  $ ${c.argv.join(' ')}\n`);
  else if (c.diff) out.write(`${c.diff.split('\n').map((l) => `  ${l}`).join('\n')}\n`);
}

export async function main(argv, { out = process.stdout, input = process.stdin, ctx = machineContext() } = {}) {
  const { values: o, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  const [cmd = 'ui', arg] = positionals;
  if (o.help || cmd === 'help') { out.write(`${HELP}\n`); return 0; }
  if (cmd === 'plan' || cmd === 'apply') {
    const agents = selectedAgents(ctx, o.agents);
    if (!agents.length) { out.write('no agent found (claude, codex, gemini, copilot); the app installs none\n'); return 1; }
    const plan = preview(globalPlan({ ctx, agents, options: { packs: o.pack ?? [] } }));
    if (!plan.length) { out.write(`nothing to change for ${agents.join(', ')}\n`); return 0; }
    if (cmd === 'plan') {
      plan.forEach((c) => show(c, out));
      out.write(`${plan.length} changes. Apply: benchkeeper apply${o.agents ? ` --agents ${o.agents}` : ''}\n`);
      return 0;
    }
    return report(apply(plan, ctx, { scope: 'global', select: await choose(plan, o, input, out) }), out);
  }
  if (cmd === 'project') {
    const dir = resolve(positionals[2] ?? '.');
    const pctx = { ...ctx, roots: [...ctx.roots, dir] };
    const answers = { agents: o.agents?.split(','), env: o.env, sandbox: o.sandbox, packs: o.pack, skills: o.skill, tier: o.tier };
    const { changes, prompts } = projectPlan({ ctx: pctx, dir, answers, plugins: installedPlugins(ctx) });
    const plan = preview(changes);
    if (arg === 'plan') {
      plan.forEach((c) => show(c, out));
      out.write(`${plan.length} changes.\n`);
    } else if (arg === 'apply') {
      const code = plan.length ? report(apply(plan, pctx, { scope: dir, select: await choose(plan, o, input, out) }), out) : 0;
      if (code) return code;
    } else { out.write('project needs plan or apply\n'); return 2; }
    out.write('Then, in an agent session the app records:\n');
    for (const p of prompts) out.write(`  benchkeeper record --project ${dir} -- ${p.agent} '${p.prompt}'   (${p.why})\n`);
    return 0;
  }
  if (cmd === 'projects') {
    const dirs = positionals.slice(2);
    if (arg === 'add') dirs.forEach((d) => out.write(`added ${addProject(ctx, d)}\n`));
    else if (arg === 'scan') for (const d of scan(dirs[0] ?? '.')) out.write(`found ${d}${listProjects(ctx).some((p) => p.path === d) ? ' (registered)' : `: benchkeeper projects add ${d}`}\n`);
    else if (arg === 'remove') dirs.forEach((d) => { removeProject(ctx, d); out.write(`removed ${resolve(d)}\n`); });
    else if (arg && arg !== 'list') { out.write(`unknown projects command ${arg}\n`); return 2; }
    if (!arg || arg === 'list') for (const p of listProjects(ctx)) out.write(`${p.path}\n`);
    return 0;
  }
  if (cmd === 'update-all') {
    const projects = listProjects(ctx).map((p) => status(ctx, p.path));
    if (!projects.length) { out.write('no projects: benchkeeper projects add <dir>\n'); return 1; }
    for (const p of projects) {
      const why = !p.setupVersion ? 'no state file, skipped' : p.error ?? (!p.repo ? 'not a git repository, skipped' : !p.clean ? 'working tree has changes, skipped' : `${p.changes.length} changes`);
      out.write(`${p.path}  setup ${p.setupVersion ?? '-'}  ${why}\n`);
      if (p.clean && p.changes) p.changes.forEach((c) => out.write(`  ${c.title}${c.kind === 'command' ? `\n    $ ${c.argv.join(' ')}` : ''}\n`));
    }
    const ready = projects.filter((p) => p.repo && p.clean && p.changes?.length);
    if (!ready.length) { out.write('nothing to update\n'); return 0; }
    const what = `${ready.length} projects: branch chore/agent-setup-${appVersion}, one commit${o['no-push'] ? '' : ', git push and gh pr create where origin is on GitHub'}`;
    if (!o.yes && !(await confirm(`Update ${what}?`, input, out))) return 1;
    const results = updateAll(ctx, { paths: ready.map((p) => p.path), push: !o['no-push'] });
    for (const r of results) out.write(`${r.status.padEnd(12)} ${r.path}${r.pr ? `  ${r.pr}` : ''}${r.reason ? `: ${r.reason}` : ''}\n`);
    return results.some((r) => r.status === 'stopped') ? 1 : 0;
  }
  if (cmd === 'record') {
    const argv = positionals.slice(1);
    if (!argv.length) { out.write('record needs the agent command after --\n'); return 2; }
    const dir = resolve(o.project ?? '.');
    const run = recordSession({ ...ctx, roots: [...ctx.roots, dir] }, dir, argv);
    const e = run.entries[0];
    out.write(`session exit ${e.exit}, ${e.files.length} files changed${e.transcript ? `, transcript ${e.transcript}` : ''}\nrun ${run.id}: undo with benchkeeper undo ${run.id}\n`);
    return 0;
  }
  if (cmd === 'history') {
    for (const r of ctx.ledger.list()) out.write(`${r.id}  ${r.kind.padEnd(5)} ${(r.status ?? 'interrupted').padEnd(11)} ${r.scope}  ${r.entries.length} changes${r.of ? ` (undo of ${r.of})` : ''}\n`);
    for (const b of legacyBackups(ctx)) out.write(`${b}  setup.sh backup: benchkeeper restore ${b}\n`);
    return 0;
  }
  if (cmd === 'undo' || cmd === 'restore') {
    if (!arg) { out.write(`${cmd} needs a name, see benchkeeper history\n`); return 2; }
    const scope = cmd === 'undo' ? ctx.ledger.get(arg).scope : 'global';
    const uctx = scope === 'global' ? ctx : { ...ctx, roots: [...ctx.roots, scope] };
    return report(cmd === 'undo' ? undo(arg, uctx, { step: o.step }) : restoreLegacy(arg, ctx), out);
  }
  out.write(`unknown command ${cmd}\n\n${HELP}\n`);
  return 2;
}
