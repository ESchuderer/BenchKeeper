// Command line: every UI action is also a command here.
import { createInterface } from 'node:readline/promises';
import { homedir } from 'node:os';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { detect } from './agents.mjs';
import { appVersion } from './content.mjs';
import { PROFILES, baselineIssues } from './baseline.mjs';
import { apply, context, legacyBackups, preview, restoreLegacy, undo } from './runner.mjs';
import { addCase } from './cases.mjs';
import { doctor } from './doctor.mjs';
import { evalPlan, runEval } from './eval.mjs';
import { harnessTest } from './harness.mjs';
import { launch, openBrowser, startServer } from './server.mjs';
import { writeAtomic } from './fsx.mjs';
import { exportProfile, importChoices, importPlan, installedPacks, readProfile } from './profile.mjs';
import { exportPack, importPack, libraryWith, removePack, savePack } from './packs.mjs';
import { addProject, canon, listProjects, packsInUse, removeProject, scan, status, unshare, updateAll } from './projects.mjs';
import { recordSession } from './session.mjs';
import { scanSessions } from './sessions.mjs';
import { writeBoard } from './board.mjs';
import { detectLevel, levelFor } from './level.mjs';
import { LEVELS, globalPlan, installedPlugins } from './steps/global.mjs';
import { projectCtx, projectPlan } from './steps/project.mjs';

export const HELP = `benchkeeper ${appVersion}: installs, updates and undoes the BenchKeeper agent setup.

Usage: benchkeeper <command> [options]

  ui [--no-open] [--port N]         local web UI (default command)
  plan [--agents a,b] [--pack p] [--level l]
                                    global setup: the changes, with a diff each, nothing written
  apply [--agents a,b] [--pack p] [--level l] [--yes] [--all]
                                    global setup: asks per change; --yes takes the default selection,
                                    --all also the removals. --level lite|standard: the BenchKeeper plugin
                                    alone, nothing else on the machine (standard: then project apply writes
                                    the local block per repository); full: rules, settings, plugins, tools.
                                    Default: the level found (doctor shows it), full on a machine without BenchKeeper
  profile export [file] [--agents a,b]
                                    agents, packs, own packs and registered projects with their answers as one file
  profile import <file> [--yes]     shows the global and project changes, applies the chosen ones; missing paths are skipped
  doctor [dir] [--agents a,b] [--baseline auto|oss|private-advisory] [--baseline-ref ref]
                                    the install level, setup problems with a fix each, nothing written; exit 1 on an error;
                                    --baseline also compares the GitHub settings and caller workflows with a
                                    repo-baseline profile (read-only gh api; auto: advisory for private repositories)
  case add --target skill:<name>|rule:<name> --expected <text> [--should-not] [--run <session run>]
           [--project dir] [--transcript file] [--description text] [--query text]
                                    records an observed miss as an eval case (~/.config/benchkeeper/evals/)
  test [dir] [--agents a,b]         deterministic checks: files match the ledger, expected plugins and skills,
                                    nothing unexpected installed, project skills at the library pins; exit 1 on a failure
  eval [--agents a,b] [--model m] [--target t] [--all] [--yes]
                                    skill trigger evals with real agent sessions (subscription use, never in CI);
                                    only targets changed since their last result unless --all
  history                           runs, newest first
  undo <run> [--step <step>]        restores the files of a run or one of its steps
  restore <name>                    restores a setup.sh backup (~/.config/benchkeeper/backup/<name>)
  project plan|apply [dir] [--agents a,b] [--env e] [--sandbox] [--pack p] [--skill s] [--tier t] [--yes]
                    [--disable s] [--enable s] [--share|--local] [--caller promote|lint-js|lint-python|sonar]
                                    project setup; answers default to the project's .benchkeeper/state.json;
                                    local (the default): CLAUDE.local.md, AGENTS.override.md and skills that git
                                    ignores (.git/info/exclude); --share commits them (AGENTS.md block, CLAUDE.md);
                                    --disable moves a skill to .benchkeeper/disabled/, --enable moves it back;
                                    --caller writes that repo-baseline workflow file (never GitHub settings)
  packs [list|save <id> --skill s..|export <id>|import <file> [--id i]|remove <id>]
                                    library packs and own packs (~/.config/benchkeeper/packs/)
  projects [list|add <dir>..|scan <root>|remove <dir>]
                                    projects Update all covers (~/.config/benchkeeper/projects.json)
  projects unshare [dir..] [--yes] [--no-push]
                                    per project whose repository still carries a setup kept local: a pull request
                                    that removes it (branch chore/agent-setup-local); default: every such project
  update-all [--yes] [--no-push] [--baseline auto|oss|private-advisory]
                                    per project: local setup (the default) applied in the checkout; shared setup
                                    (project apply --share) on branch chore/agent-setup-<version> in a worktree,
                                    one commit, push and pull request when origin is on GitHub;
                                    --baseline also reports each project's GitHub settings drift, changing none
  board [--no-open]                 sessions board of the Claude Code and Codex transcripts on this machine:
                                    tier, setup, skills, tests, cost, pull requests (~/.config/benchkeeper/board.html)
  record [--project dir] -- <agent> [args]
                                    runs an agent session and records the files it changes (undo restores them)

Agents: claude, codex, gemini, copilot (default: the installed ones). Packs: see plugins/benchkeeper/library/README.md.
Env (where the agent runs): container (default; host-agent or host when AGENTS.md says the agent runs on the host), host-agent, sandbox, host. Tier: quick, standard, full, research.`;

const OPTIONS = {
  agents: { type: 'string' }, pack: { type: 'string', multiple: true }, yes: { type: 'boolean' }, all: { type: 'boolean' },
  step: { type: 'string' }, 'no-open': { type: 'boolean' }, port: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  env: { type: 'string' }, sandbox: { type: 'boolean' }, share: { type: 'boolean' }, local: { type: 'boolean' }, skill: { type: 'string', multiple: true }, tier: { type: 'string' }, project: { type: 'string' },
  'no-push': { type: 'boolean' }, disable: { type: 'string', multiple: true }, enable: { type: 'string', multiple: true }, id: { type: 'string' },
  level: { type: 'string' }, target: { type: 'string', multiple: true }, model: { type: 'string' }, expected: { type: 'string' }, 'should-not': { type: 'boolean' }, transcript: { type: 'string' },
  description: { type: 'string' }, query: { type: 'string' }, run: { type: 'string' },
  baseline: { type: 'string' }, 'baseline-ref': { type: 'string' }, caller: { type: 'string', multiple: true },
};

// One line reader per command, so several questions share the input. Lines, not rl.question: piped answers that
// end early count as no.
function asker(input, out) {
  let rl, lines;
  const ask = async (question) => {
    out.write(`${question} [y/N] `);
    rl ??= createInterface({ input, terminal: false });
    lines ??= rl[Symbol.asyncIterator]();
    const { value = '' } = await lines.next();
    return /^y$/i.test(value.trim());
  };
  ask.close = () => rl?.close();
  return ask;
}

async function choose(plan, o, ask, out) {
  if (o.yes || o.all) return plan.filter((c) => !c.error && (o.all || c.selected)).map((c) => c.id);
  const select = [], units = new Map();
  for (const c of plan) {
    show(c, out);
    // One answer per unit: its changes go together.
    if (c.unit && units.has(c.unit)) { if (units.get(c.unit)) select.push(c.id); continue; }
    const yes = !c.error && (await ask(c.unit ? 'apply (with the changes that go with it)?' : 'apply?'));
    if (c.unit) units.set(c.unit, yes);
    if (yes) select.push(c.id);
  }
  return select;
}

function report(run, out) {
  for (const e of run.entries) out.write(`${e.status.padEnd(7)} ${e.title}${e.error || e.reason ? `: ${e.error ?? e.reason}` : ''}\n`);
  if (run.kind !== 'undo') out.write(`run ${run.id}: undo with benchkeeper undo ${run.id}\n`);
  return run.status === 'done' ? 0 : 1;
}

export function machineContext(env = process.env) {
  const home = env.BENCHKEEPER_HOME || homedir();
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
  const ask = asker(input, out);
  try { return await command(argv, { out, ask, ctx }); } finally { ask.close(); }
}

async function command(argv, { out, ask, ctx }) {
  const { values: o, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  const [cmd = 'ui', arg] = positionals;
  if (o.help || cmd === 'help') { out.write(`${HELP}\n`); return 0; }
  if (cmd === 'ui') {
    const { server, url } = await startServer(ctx, { port: o.port ? Number(o.port) : 0 });
    out.write(`BenchKeeper UI: ${url}\nThe link works once. Ctrl+C stops the server.\n`);
    if (!o['no-open']) openBrowser(url);
    await new Promise((done) => server.on('close', done));
    return 0;
  }
  if (cmd === 'plan' || cmd === 'apply') {
    const agents = selectedAgents(ctx, o.agents);
    if (!agents.length) { out.write('no agent found (claude, codex, gemini, copilot); the app installs none\n'); return 1; }
    if (o.level && !LEVELS.includes(o.level)) { out.write(`--level must be one of ${LEVELS.join(', ')}\n`); return 2; }
    const level = o.level ?? levelFor(ctx, agents);
    if (!o.level && level !== 'full') out.write(`level ${level} (found on this machine): ${detectLevel(ctx, agents).adds}\n`);
    const plan = preview(globalPlan({ ctx, agents, options: { packs: o.pack ?? [], packsInUse: packsInUse(ctx), level } }));
    if (!plan.length) { out.write(`nothing to change for ${agents.join(', ')}\n`); return 0; }
    if (cmd === 'plan') {
      plan.forEach((c) => show(c, out));
      out.write(`${plan.length} changes. Apply: benchkeeper apply${o.agents ? ` --agents ${o.agents}` : ''}\n`);
      return 0;
    }
    return report(apply(plan, ctx, { scope: 'global', select: await choose(plan, o, ask, out) }), out);
  }
  if (cmd === 'project') {
    const dir = resolve(positionals[2] ?? '.');
    if (o.share && o.local) { out.write('--share and --local exclude each other\n'); return 2; }
    const pctx = projectCtx(ctx, dir);
    const answers = { agents: o.agents?.split(','), env: o.env, sandbox: o.sandbox, share: o.share ? true : o.local ? false : undefined, packs: o.pack, skills: o.skill, tier: o.tier, disable: o.disable, enable: o.enable, callers: o.caller };
    const { changes, prompts, skills, warnings } = projectPlan({ ctx: pctx, dir, answers, plugins: installedPlugins(ctx) });
    const plan = preview(changes);
    if (skills.added.length || skills.removed.length) out.write(`skills: ${[...skills.added.map((n) => `+${n}`), ...skills.removed.map((n) => `-${n}`)].join(' ')}\n`);
    for (const w of warnings) out.write(`warning: ${w}\n`);
    if (arg === 'plan') {
      plan.forEach((c) => show(c, out));
      out.write(`${plan.length} changes.\n`);
    } else if (arg === 'apply') {
      const code = plan.length ? report(apply(plan, pctx, { scope: dir, select: await choose(plan, o, ask, out) }), out) : 0;
      if (code) return code;
    } else { out.write('project needs plan or apply\n'); return 2; }
    out.write('Then, in an agent session the app records:\n');
    for (const p of prompts) out.write(`  benchkeeper record --project ${dir} -- ${p.agent} '${p.prompt}'   (${p.why})\n`);
    return 0;
  }
  if (cmd === 'packs') {
    if (arg === 'save') out.write(`saved ${savePack(ctx, { id: positionals[2], skills: o.skill ?? [] }).id}\n`);
    else if (arg === 'export') out.write(exportPack(ctx, positionals[2]));
    else if (arg === 'import') out.write(`imported ${importPack(ctx, readFileSync(positionals[2], 'utf8'), o.id).id}\n`);
    else if (arg === 'remove') { removePack(ctx, positionals[2]); out.write(`removed ${positionals[2]}\n`); }
    else if (arg && arg !== 'list') { out.write(`unknown packs command ${arg}\n`); return 2; }
    else for (const p of libraryWith(ctx).packs) out.write(`${p.id.padEnd(16)} ${p.own ? 'own    ' : 'library'} ${p.skills?.join(', ') ?? `plugin: ${Object.values(p.plugins ?? {}).map((x) => x.id).join(', ')}`}\n`);
    return 0;
  }
  if (cmd === 'projects') {
    const dirs = positionals.slice(2);
    if (arg === 'add') dirs.forEach((d) => out.write(`added ${addProject(ctx, d)}\n`));
    else if (arg === 'scan') for (const d of scan(dirs[0] ?? '.')) out.write(`found ${d}${listProjects(ctx).some((p) => p.path === canon(d)) ? ' (registered)' : `: benchkeeper projects add ${d}`}\n`);
    else if (arg === 'remove') dirs.forEach((d) => { removeProject(ctx, d); out.write(`removed ${resolve(d)}\n`); });
    else if (arg === 'unshare') {
      const due = (dirs.length ? dirs.map((d) => resolve(d)) : listProjects(ctx).map((p) => p.path)).map((d) => status(ctx, d)).filter((p) => p.committed || dirs.length);
      if (!due.length) { out.write('no project carries a committed setup\n'); return 0; }
      for (const p of due) out.write(`${p.path}  setup ${p.origin ?? '-'} on origin${p.clean ? '' : ', working tree has changes: skipped'}\n`);
      const ready = due.filter((p) => p.clean);
      if (!ready.length) return 1;
      if (!o.yes && !(await ask(`Open ${ready.length} pull requests (branch chore/agent-setup-local)${o['no-push'] ? ' without pushing' : ''}?`))) return 1;
      const results = ready.map((p) => unshare(ctx, p.path, { push: !o['no-push'] }));
      for (const r of results) out.write(`${r.status.padEnd(12)} ${r.path}${r.pr ? `  ${r.pr}` : ''}${r.reason ? `: ${r.reason}` : ''}\n`);
      return results.some((r) => r.status === 'stopped') ? 1 : 0;
    }
    else if (arg && arg !== 'list') { out.write(`unknown projects command ${arg}\n`); return 2; }
    if (!arg || arg === 'list') for (const p of listProjects(ctx)) out.write(`${p.path}\n`);
    return 0;
  }
  if (cmd === 'update-all') {
    if (o.baseline && !['auto', ...PROFILES].includes(o.baseline)) { out.write(`--baseline must be auto, ${PROFILES.join(' or ')}\n`); return 2; }
    const projects = listProjects(ctx).map((p) => status(ctx, p.path));
    if (!projects.length) { out.write('no projects: benchkeeper projects add <dir>\n'); return 1; }
    for (const p of projects) {
      const commits = p.share || p.committed;
      const why = !p.setupVersion ? 'no state file, skipped' : p.error ?? (!p.repo ? 'not a git repository, skipped' : !p.clean && commits ? 'working tree has changes, skipped'
        : p.changes ? `${p.changes.length} changes` : `setup ${p.setupVersion} on ${p.origin}, checkout ${p.checkout ?? 'without one'}${p.current ? ': pull it' : ''}`);
      out.write(`${p.path}  setup ${p.setupVersion ?? '-'}  ${why}\n`);
      if ((p.clean || !commits) && p.changes) p.changes.forEach((c) => out.write(`  ${c.title}${c.kind === 'command' ? `\n    $ ${c.argv.join(' ')}` : ''}\n`));
    }
    if (o.baseline) {
      for (const p of projects) {
        out.write(`${p.path}  GitHub settings against profile ${o.baseline} (report only)\n`);
        for (const i of baselineIssues(ctx, p.path, { profile: o.baseline, ref: o['baseline-ref'] })) out.write(`  ${(i.tag ?? i.level).padEnd(8)} ${i.message}\n`);
      }
    }
    // A checkout behind origin's setup gets its changes from there: Update all starts at origin's default branch.
    const ready = projects.filter((p) => p.repo && (p.clean || !(p.share || p.committed)) && !p.error && (p.changes?.length || (p.checkout !== p.setupVersion && !p.current)));
    if (!ready.length) { out.write('nothing to update\n'); return 0; }
    const shared = ready.filter((p) => p.share).length;
    const what = `${ready.length} projects: ${ready.length - shared} local in the checkout${shared ? `, ${shared} shared on branch chore/agent-setup-${appVersion}, one commit${o['no-push'] ? '' : ', git push and gh pr create where origin is on GitHub'}` : ''}`;
    if (!o.yes && !(await ask(`Update ${what}?`))) return 1;
    const results = updateAll(ctx, { paths: ready.map((p) => p.path), push: !o['no-push'] });
    for (const r of results) out.write(`${r.status.padEnd(12)} ${r.path}${r.pr ? `  ${r.pr}` : ''}${r.reason ? `: ${r.reason}` : ''}\n`);
    return results.some((r) => r.status === 'stopped') ? 1 : 0;
  }
  if (cmd === 'board') {
    out.write('Reading the transcripts; the first run reads all of them, later runs only new or changed ones.\n');
    const rows = await scanSessions(ctx);
    const file = writeBoard(ctx, rows);
    out.write(`${rows.length} sessions: ${file}\n`);
    // A file URL carries no token: opened directly, as the CLI exits before a redirect file would be read.
    if (!o['no-open']) launch(pathToFileURL(file).href);
    return 0;
  }
  if (cmd === 'record') {
    const argv = positionals.slice(1);
    if (!argv.length) { out.write('record needs the agent command after --\n'); return 2; }
    const dir = resolve(o.project ?? '.');
    const run = recordSession({ ...ctx, roots: [dir] }, dir, argv);
    const e = run.entries[0];
    out.write(`session exit ${e.exit}, ${e.files.length} files changed${e.transcript ? `, transcript ${e.transcript}` : ''}\nrun ${run.id}: undo with benchkeeper undo ${run.id}\n`);
    return 0;
  }
  if (cmd === 'profile') {
    if (arg === 'export') {
      const text = exportProfile(ctx, { agents: selectedAgents(ctx, o.agents), packs: installedPacks(ctx) });
      if (positionals[2]) { writeAtomic(resolve(positionals[2]), text); out.write(`wrote ${resolve(positionals[2])}\n`); } else out.write(text);
      return 0;
    }
    if (arg !== 'import' || !positionals[2]) { out.write('profile needs export [file] or import <file>\n'); return 2; }
    const p = readProfile(readFileSync(positionals[2], 'utf8'));
    // Own packs first: the project plans can name them.
    const done = importChoices(ctx, p);
    out.write(`own packs: ${done.packs.join(', ') || 'none'}\nregistered projects: ${done.projects.join(', ') || 'none'}\n`);
    const plan = importPlan(ctx, p);
    for (const m of plan.missing) out.write(`skipped ${m}: not on this machine\n`);
    let code = 0;
    if (plan.global.length) code |= report(apply(plan.global, ctx, { scope: 'global', select: await choose(plan.global, o, ask, out) }), out);
    for (const x of plan.projects.filter((y) => y.changes.length)) {
      out.write(`project ${x.path}\n`);
      code |= report(apply(x.changes, x.ctx, { scope: x.path, select: await choose(x.changes, o, ask, out) }), out);
    }
    return code;
  }
  if (cmd === 'doctor') {
    if (o.baseline && !['auto', ...PROFILES].includes(o.baseline)) { out.write(`--baseline must be auto, ${PROFILES.join(' or ')}\n`); return 2; }
    const agents = selectedAgents(ctx, o.agents), dir = resolve(arg ?? '.');
    const { level, adds } = detectLevel(ctx, agents, dir);
    out.write(`level    ${level ?? 'none'}${adds ? `: ${adds}` : ''}\n`);
    const found = doctor(ctx, { agents, dir, baseline: o.baseline && { profile: o.baseline, ref: o['baseline-ref'] } });
    for (const i of found) out.write(`${(i.tag ?? i.level).padEnd(8)} ${i.check.padEnd(10)} ${i.message}\n        fix: ${i.fix}\n`);
    out.write(found.length ? `${found.filter((i) => i.level === 'error').length} errors, ${found.filter((i) => i.level === 'warning').length} warnings\n` : 'no problems found\n');
    return found.some((i) => i.level === 'error') ? 1 : 0;
  }
  if (cmd === 'case') {
    if (arg !== 'add') { out.write('case needs add\n'); return 2; }
    // A session run gives the project and transcript.
    const session = o.run ? ctx.ledger.get(o.run) : null;
    const r = addCase(ctx, { target: o.target?.[0], expected: o.expected, should: !o['should-not'], run: o.run, query: o.query, description: o.description,
      project: o.project ? resolve(o.project) : session?.scope, transcript: o.transcript ? resolve(o.transcript) : session?.entries[0]?.transcript ?? undefined });
    out.write(`case ${r.case.id} in ${r.path}\nquery: ${r.case.query.split('\n')[0].slice(0, 120)}\nrun ${r.run}: undo with benchkeeper undo ${r.run}\n`);
    return 0;
  }
  if (cmd === 'test') {
    const checks = harnessTest(ctx, { agents: selectedAgents(ctx, o.agents), dir: arg ? resolve(arg) : undefined });
    for (const c of checks) out.write(`${c.ok ? 'ok  ' : 'fail'}  ${c.name}${c.problems.map((p) => `\n      ${p}`).join('')}\n`);
    return checks.every((c) => c.ok) ? 0 : 1;
  }
  if (cmd === 'eval') {
    if (process.env.CI) { out.write('eval starts agent sessions on a subscription and does not run in CI\n'); return 2; }
    const plan = evalPlan(ctx, { agents: o.agents?.split(',') ?? ['claude'], model: o.model, all: o.all, only: o.target });
    const sessions = plan.reduce((n, p) => n + p.cases.length, 0);
    if (!plan.length) { out.write('every target is unchanged since its last result (--all runs them again)\n'); return 0; }
    for (const p of plan) out.write(`${p.target}  ${p.agent}${p.model ? ` ${p.model}` : ''}  ${p.cases.length} cases\n`);
    if (!o.yes && !(await ask(`Start ${sessions} agent sessions?`))) return 1;
    for (const r of await runEval(ctx, plan)) {
      const pct = (x) => (x == null ? '-' : `${Math.round(x * 100)}%`);
      out.write(`${r.target}  ${r.agent} ${r.agentVersion}${r.model ? ` ${r.model}` : ''}  miss ${pct(r.missRate)}  false trigger ${pct(r.falseTriggerRate)}${r.details.some((d) => d.review) ? `  review: ${r.details.find((d) => d.review).review.replace(/[^/]+$/, '')}` : ''}\n`);
    }
    return 0;
  }
  if (cmd === 'history') {
    for (const r of ctx.ledger.list()) {
      const note = r.note?.case ? ` (eval case ${r.note.case} for ${r.note.target}${r.note.run ? `, from ${r.note.run}` : ''})` : r.kind === 'session' ? ` (a miss: benchkeeper case add --run ${r.id} --target ... --expected ...)` : '';
      out.write(`${r.id}  ${r.kind.padEnd(7)} ${(r.status ?? 'interrupted').padEnd(11)} ${r.scope}  ${r.entries.length} changes${r.of ? ` (undo of ${r.of})` : ''}${note}\n`);
    }
    for (const b of legacyBackups(ctx)) out.write(`${b}  setup.sh backup: benchkeeper restore ${b}\n`);
    return 0;
  }
  if (cmd === 'undo' || cmd === 'restore') {
    if (!arg) { out.write(`${cmd} needs a name, see benchkeeper history\n`); return 2; }
    const scope = cmd === 'undo' ? ctx.ledger.get(arg).scope : 'global';
    const uctx = scope === 'global' ? ctx : projectCtx(ctx, scope);
    return report(cmd === 'undo' ? undo(arg, uctx, { step: o.step }) : restoreLegacy(arg, ctx), out);
  }
  out.write(`unknown command ${cmd}\n\n${HELP}\n`);
  return 2;
}
