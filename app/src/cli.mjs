// Command line: every UI action is also a command here.
import { createInterface } from 'node:readline/promises';
import { homedir } from 'node:os';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { AGENTS, NeedsConfirm, accountDoc, accountStatus, accountsProblem, addChange, commit, findAccount, limitsChange, listAccounts, login, newAccount, pickAccount, registrySettings, removeChange, runAs, settingsChange, store, tokenChange, trackChanges, trackContainer, useChange, writeContainer } from './accounts.mjs';
import { WINDOWS, limitsFor, settingsOf } from './usage.mjs';
import { detect } from './agents.mjs';
import { appVersion } from './content.mjs';
import { PROFILES, baselineIssues } from './baseline.mjs';
import { apply, context, legacyBackups, preview, restoreLegacy, undo } from './runner.mjs';
import { addCase } from './cases.mjs';
import { doctor } from './doctor.mjs';
import { evalPlan, runEval } from './eval.mjs';
import { harnessTest } from './harness.mjs';
import { launch, openBrowser, startServer } from './server.mjs';
import { listFiles, writeAtomic } from './fsx.mjs';
import { mask } from './redact.mjs';
import { exportProfile, importChoices, importPlan, installedPacks, readProfile } from './profile.mjs';
import { frameworkRows } from './frameworks.mjs';
import { exportPack, importPack, invalidPacks, libraryWith, removePack, savePack } from './packs.mjs';
import { MAX_PROJECTS, addProject, canon, listProjects, packsInUse, projectsUsing, pushTargets, registryProblem, relocateProject, removeProject, removeSetup, renameProject, scan, setupRemoval, status, unshare, updateAll } from './projects.mjs';
import { extensionLines, extensionsView } from './extensions.mjs';
import { RULE_AGENTS, ruleChanges, rulesView } from './rules.mjs';
import { recordSession } from './session.mjs';
import { bundleEdits, describeKey, isSettingsFile, listSettings, parseInput, redact, settingsAgents, settingsChanges } from './settings.mjs';
import { scanSessions } from './sessions.mjs';
import { collectInsights } from './insights.mjs';
import { writeBoard } from './board.mjs';
import { detectLevel } from './level.mjs';
import { PLUGINS, LEVELS, globalPlan, installedPlugins } from './steps/global.mjs';
import { projectCtx, projectPlan, scopeCtx, tryState } from './steps/project.mjs';
import { focusOn, globalUntracked, projectSkills, skillAction } from './skills.mjs';
import { clearKnowledge, entryLine, knowledgeDir, linkedParent, readKnowledge } from './knowledge.mjs';

export const HELP = `benchkeeper ${appVersion}: installs, updates and undoes the BenchKeeper agent setup.

Usage: benchkeeper <command> [options]

  ui [--no-open] [--port N]         local web UI (default command)
  plan [--agents a,b] [--pack p] [--level l]
                                    global setup: the changes, with a diff each, nothing written
  apply [--agents a,b] [--pack p] [--level l] [--yes] [--all]
                                    global setup: asks per change; --yes takes the default selection,
                                    --all also the removals. --level lite|standard: the BenchKeeper plugin
                                    alone, nothing else on the machine (standard: then projects apply writes
                                    the local block per repository); full: rules, settings, plugins, tools.
                                    Default: the level found (doctor shows it), full on a machine without BenchKeeper
  profile export [file] [--agents a,b]
                                    agents, packs, own packs and registered projects with their answers as one file
  profile import <file> [--yes]     shows the global and project changes, applies the chosen ones; missing paths are skipped
  doctor [dir] [--agents a,b] [--baseline auto|oss|private-advisory] [--baseline-ref ref]
                                    the install level, setup problems with a fix each, nothing written; exit 1 on an error;
                                    --baseline also compares the GitHub settings and caller workflows with a
                                    repo-baseline profile (read-only gh api; auto: advisory for private repositories)
  settings list [--agent claude|codex] [--advanced] [--project dir]
  settings get <key> [--agent a] [--project dir]
  settings set <key> <value> | --unset | --bundle <id> [--agent a] [--layer user|project|local] [--project dir] [--yes]
                                    agent settings (Claude Code settings.json, Codex config.toml) with notes on keys
                                    that cancel each other; a change is a plan with a diff, undo restores it;
                                    environment switches are set (value "set") or removed, never 0 or false;
                                    managed settings are never written
  rules list [--agent claude|codex] [--project dir]
  rules disable|enable <file> [--agent a] [--project dir] [--yes]
                                    the instruction files each agent loads: owner, size, whether they load, and the
                                    context they cost with skill descriptions, imports and auto memory; disable leaves
                                    one file out (Claude Code: claudeMdExcludes in the user settings, or in the
                                    project's local settings with --project; a global Codex file moves to a folder of
                                    the app's own); nothing is deleted, the plan has a diff and undo restores it
  extensions list [--agent claude|codex] [--project dir]
                                    MCP servers, hooks, subagents, commands and output styles each agent loads,
                                    read from files only (no agent starts), with owner and a runs-code mark; env
                                    values, headers and secrets never appear; nothing is written
  evals cases add --target skill:<name>|rule:<name> --expected <text> [--should-not] [--run <session run>]
           [--project dir] [--scope project|user] [--transcript file] [--description text] [--query text]
                                    records an observed miss as an eval case (~/.config/benchkeeper/evals/); a skill with
                                    no library counterpart is read from --project's or your skill folders (--scope picks one)
  evals plan|run [--agents a,b] [--model m] [--target t] [--all] [--yes]
                                    skill trigger evals with real agent sessions (subscription use, never in CI);
                                    only targets changed since their last result unless --all; plan lists the targets and
                                    sessions and starts none, run asks first (--yes answers it)
  verify [dir] [--agents a,b]       deterministic checks: files match the ledger, expected plugins and skills,
                                    nothing unexpected installed, project skills at the library pins; exit 1 on a failure
  history                           runs, newest first
  undo <run> [--step <step>]        restores the files of a run or one of its steps
  restore <name>                    restores a setup.sh backup (~/.config/benchkeeper/backup/<name>)
  projects plan|apply [dir] [--agents a,b] [--env e] [--sandbox] [--pack p] [--skill s] [--tier t] [--yes]
                    [--framework f|none] [--agent-file path]
                    [--share|--local] [--caller lint-js|lint-python|sonar]
                                    project setup; answers default to the project's .benchkeeper/state.json;
                                    local (the default): CLAUDE.local.md, AGENTS.override.md and skills that git
                                    ignores (.git/info/exclude); --share commits them (AGENTS.md block, CLAUDE.md);
                                    --caller writes that repo-baseline workflow file (never GitHub settings);
                                    --framework names the frameworks of this project (one workflow owner at most,
                                    none clears the plugin and agent ones; a pack
                                    framework is a pack: packs disable), --agent-file picks the agent files of agency-agents
  frameworks [list]                 the frameworks a project can add, with the evidence and what each install writes
  packs [list|save <id> --skill s..|export <id>|import <file> [--id i]|remove <id>]
                                    library packs and own packs (own ones in packs/ of the config folder); remove
                                    refuses a pack a registered project still names
  packs enable|disable <id>.. [--project dir | --global] [--yes]
                                    switches packs on top of the current state, as a plan with a diff (undo restores it):
                                    a project's packs (default: the current folder), or the plugins of a pack that
                                    installs one (--global). Disabling removes the skills no other pack or single pick needs
  skills [list|update|reset|remove|adopt|enable|disable] [name..] [--project dir] [--yes]
                                    skills of a project: state (current, outdated, modified, removed, disabled), the commit
                                    installed and the one the library offers, and folders no setup installed (untracked,
                                    never touched). update: to the library's copy (no name: every outdated one); reset: a
                                    skill edited here goes back to the library's (the edit is backed up, the diff shown);
                                    remove: a single pick leaves the project; adopt: an untracked library skill becomes a pick;
                                    disable moves a skill to .benchkeeper/disabled/, enable moves it back (names required)
  projects [list|add <dir>..|scan <root>|remove <dir>..]
                                    projects Update all covers (projects.json in the config folder); add refuses another worktree
                                    of a registered repository unless --worktree; remove only unregisters
  projects rename <dir> [name] [--notes text]
                                    display name and notes (in projects.json only; an empty one clears it)
  projects relocate <old> <new>     the folder moved: the entry, its answers and its history follow it
  projects remove <dir>.. --setup [--yes] [--no-push]
                                    takes BenchKeeper's setup out of each project and keeps it registered: a local setup in the
                                    checkout (one run, undo with benchkeeper undo <run>), a shared one as a pull request
                                    (branch chore/remove-agent-setup); lists the files, then asks
  projects unshare [dir..] [--yes] [--no-push]
                                    per project whose repository still carries a setup kept local: a pull request
                                    that removes it (branch chore/agent-setup-local); default: every such project
  projects update [dir..] [--yes] [--no-push] [--dry-run] [--max N] [--baseline auto|oss|private-advisory]
                                    dir..: only these registered projects (default: all); per project: local setup (the
                                    default) applied in the checkout; shared setup
                                    (projects apply --share) on branch chore/agent-setup-<version> in a worktree,
                                    one commit, push and pull request when origin is on GitHub;
                                    --dry-run stops after the plan; pushes go to at most 25 repositories per run (--max N);
                                    --baseline also reports each project's GitHub settings drift, changing none
  sessions board [--no-open]        sessions board of the Claude Code and Codex transcripts on this machine:
                                    tier, setup, skills, tests, cost, pull requests (~/.config/benchkeeper/board.html)
  sessions record [--project dir] -- <agent> [args]
                                    runs an agent session and records the files it changes (undo restores them)
  accounts [list]                   the accounts per agent (Claude Code, Codex): name, agent, host or dev container, default
  accounts add [name] [--agent claude|codex] [--container --mount path] [--label text] [--dir path] [--yes]
                                    registers an account: its own folder (CLAUDE_CONFIG_DIR, CODEX_HOME) on the host, or a
                                    named volume mounted in the dev container; a plan with a diff and undo, no credential
                                    in it. Asks for what is missing, then offers the sign-in
  accounts use|remove <name> [--yes]
                                    use: the default account of its agent. remove: the registry entry and the stored token
                                    (the folder and its sign-in stay)
  accounts status [name] [--project dir]
                                    signed in or not (claude auth status, codex login status; a container account in the
                                    --project dir's running dev container), the age of a kept token and, for Claude Code,
                                    the usage left in the 5-hour and 7-day window with a notice before a limit
  accounts track <name> [--off] [--project dir] [--yes]
                                    Claude Code: installs (--off: removes) a status line script and a StopFailure hook in the
                                    account's folder; they keep the rate limit windows and failed turns for status, doctor and
                                    run. A plan with a diff and undo; a dev container account is written through devcontainer exec
  accounts limits [name] [--five-hour N] [--seven-day N] [--warn-five-hour N] [--warn-seven-day N]
                  [--pool name|none] [--auto-pick on|off] [--when-none stop|wait] [--continue-below on|off] [--reset]
                                    the minimum headroom (percent, defaults 8 and 3) below which run asks first, and the notice
                                    level before it (default twice the minimum); with a name, that account's own values and
                                    --pool (accounts of one person that auto-pick may choose among). Without a name:
                                    the defaults, --auto-pick (off by default: a new run under the default account starts under
                                    a pool member with headroom; the provider's terms on rotating accounts are unclear, so you
                                    carry that call), --when-none (no member has headroom: stop, or wait for the earliest
                                    reset) and --continue-below (run starts below the minimum without asking). No flag shows them
  accounts login <name> [--token] [--email address] [--no-browser] [--project dir]
                                    guided sign-in: opens the sign-in link in a private browser window (Firefox, Chrome,
                                    Chromium, Edge), else prints it with the code; paste the code the browser shows if it
                                    asks. --token: Claude Code setup-token kept in the OS credential store; Codex: the
                                    access token piped on stdin goes to codex login --with-access-token
  run [--account name] [--project dir] [--token] [--yes] -- claude|codex [args]
                                    runs the agent as an account (default: the agent's default account) after a sign-in
                                    check and, below the minimum headroom, a question (--yes answers it); environment: the filtered one plus the account's folder variable (--token: the
                                    kept token, Claude Code only). Dev container accounts run through devcontainer exec
  insights --json [--project dir] [--agents a,b]
                                    findings with id, severity, evidence and a fix: installed skills no session used,
                                    doctor findings, pins behind the newest release; the session signal needs 20 sessions
                                    of the last 90 days and reports nothing below that; nothing is written
  knowledge show [dir]              what the maintaining-repos skill stored for the project (.benchkeeper/knowledge/,
                                    ignored by git): entries per file; a file that does not parse is listed as ignored
  knowledge clear [dir] [--yes]
                                    removes that folder after a question and nothing else of the project

--json (doctor, verify, plan, projects plan, history, projects list and scan, packs list, skills list, rules list, extensions list,
        settings list and get, frameworks list, sessions board, insights, profile export, knowledge show, accounts list and status)
                                    one JSON document on stdout, logs on stderr; exit 0 clean, 1 findings of
                                    level error, 2 usage or read failure; keys in app/README.md

Agents: claude, codex, gemini, copilot (default: the installed ones). Packs: see plugins/benchkeeper/library/README.md.
Env (where the agent runs): container (default; host-agent or host when AGENTS.md says the agent runs on the host), host-agent, sandbox, host. Tier: quick, standard, full, research.`;

const OPTIONS = {
  agents: { type: 'string' }, pack: { type: 'string', multiple: true }, yes: { type: 'boolean' }, all: { type: 'boolean' },
  step: { type: 'string' }, 'no-open': { type: 'boolean' }, port: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  env: { type: 'string' }, sandbox: { type: 'boolean' }, share: { type: 'boolean' }, local: { type: 'boolean' }, skill: { type: 'string', multiple: true }, framework: { type: 'string', multiple: true }, 'agent-file': { type: 'string', multiple: true }, tier: { type: 'string' }, project: { type: 'string' },
  'no-push': { type: 'boolean' }, 'dry-run': { type: 'boolean' }, max: { type: 'string' }, id: { type: 'string' },
  level: { type: 'string' }, target: { type: 'string', multiple: true }, model: { type: 'string' }, expected: { type: 'string' }, 'should-not': { type: 'boolean' }, transcript: { type: 'string' },
  description: { type: 'string' }, query: { type: 'string' }, run: { type: 'string' }, scope: { type: 'string' },
  baseline: { type: 'string' }, 'baseline-ref': { type: 'string' }, caller: { type: 'string', multiple: true },
  json: { type: 'boolean' }, check: { type: 'boolean' }, agent: { type: 'string' }, layer: { type: 'string' }, advanced: { type: 'boolean' }, unset: { type: 'boolean' }, bundle: { type: 'string' },
  setup: { type: 'boolean' }, worktree: { type: 'boolean' }, notes: { type: 'string' }, global: { type: 'boolean' },
  'five-hour': { type: 'string' }, 'seven-day': { type: 'string' }, 'warn-five-hour': { type: 'string' }, 'warn-seven-day': { type: 'string' }, pool: { type: 'string' }, 'auto-pick': { type: 'string' }, 'when-none': { type: 'string' }, 'continue-below': { type: 'string' }, off: { type: 'boolean' }, reset: { type: 'boolean' },
  account: { type: 'string' }, container: { type: 'boolean' }, label: { type: 'string' }, dir: { type: 'string' }, mount: { type: 'string' }, email: { type: 'string' }, token: { type: 'boolean' }, 'no-browser': { type: 'boolean' },
};

// One line reader per command, so several questions share the input. Lines, not rl.question: piped answers that
// end early count as no. A read still open when its reader gave up (a sign-in that ended first) is the next line's.
function asker(input, out) {
  let rl, lines, pending;
  const next = () => {
    rl ??= createInterface({ input, terminal: false });
    lines ??= rl[Symbol.asyncIterator]();
    pending ??= lines.next().then(({ value }) => { pending = null; return value ?? null; });
    return pending;
  };
  const ask = async (question) => {
    out.write(`${question} [y/N] `);
    return /^y$/i.test(((await next()) ?? '').trim());
  };
  // The next line as typed (null at the end of the input), after the question when there is one.
  ask.line = (question) => { if (question) out.write(question); return next(); };
  ask.tty = !!input.isTTY;
  ask.close = () => rl?.close();
  return ask;
}

async function choose(plan, o, ask, out) {
  if (o.yes) return plan.filter((c) => !c.error && (o.all || c.selected)).map((c) => c.id);
  // --all alone is not a go-ahead: removals are on the list, so the question names them first.
  if (o.all) {
    const all = plan.filter((c) => !c.error), removals = all.filter((c) => c.destructive);
    removals.forEach((c) => show(c, out));
    return (await ask(`Apply ${all.length} changes${removals.length ? `, ${removals.length} of them removals (listed above)` : ''}?`)) ? all.map((c) => c.id) : [];
  }
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
  else if (c.diff) out.write(`${(isSettingsFile(c.path) ? redact(c.diff) : c.diff).split('\n').map((l) => `  ${l}`).join('\n')}\n`);
}

export async function main(argv, { out = process.stdout, err = process.stderr, input = process.stdin, ctx = machineContext() } = {}) {
  const ask = asker(input, out);
  try { return await command(argv, { out, err, ask, ctx }); } catch (e) {
    // With --json a failure is a document too: an unknown option, an unreadable file.
    if (!argv.includes('--json')) throw e;
    err.write(`${redact(e.message)}\n`);
    const [cmd = 'ui', arg] = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: false }).positionals;
    out.write(jsonDoc(commandName(cmd, arg), { error: redact(e.message) }));
    return 2;
  } finally { ask.close(); }
}

// projects remove --setup: every file first, then one question for all projects named.
async function removeSetups(ctx, dirs, { o, out, ask }) {
  if (!dirs.length) { out.write('projects remove --setup needs at least one directory\n'); return 2; }
  const plans = dirs.map((d) => ({ path: canon(d), ...setupRemoval(ctx, d) }));
  for (const p of plans) {
    out.write(`${p.path}  ${p.shared ? 'shared setup: a pull request on branch chore/remove-agent-setup' : 'local setup: removed in the checkout'}\n`);
    for (const c of p.changes) out.write(`  ${c.title}\n`);
    if (!p.changes.length) out.write('  nothing to remove\n');
  }
  if (!o.yes && !(await ask(`Remove the BenchKeeper setup of ${plans.length} ${plans.length === 1 ? 'project' : 'projects'} (they stay registered)?`))) return 1;
  const results = plans.map((p) => removeSetup(ctx, p.path, { push: !o['no-push'] }));
  for (const r of results) out.write(`${r.status.padEnd(12)} ${r.path}${r.pr ? `  ${r.pr}` : ''}${r.run ? `  undo: benchkeeper undo ${r.run}` : ''}${r.reason ? `: ${r.reason}` : ''}\n`);
  return results.some((r) => r.status === 'stopped') ? 1 : 0;
}

async function command(argv, { out, err, ask, ctx }) {
  const { values: o, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  const [cmd = 'ui', arg] = positionals;
  if (o.help || cmd === 'help') { out.write(`${HELP}\n`); return 0; }
  if (o.json && cmd !== 'verify') return jsonCommand({ cmd, arg, o, positionals, out, err, ctx });
  if (cmd === 'ui') {
    const { server, url } = await startServer(ctx, { port: o.port ? Number(o.port) : 0 });
    out.write(`BenchKeeper UI: ${url}\nThe link works once and for 10 minutes. Ctrl+C stops the server.\n`);
    // null: a snap or Flatpak browser, or no redirect file; the app never hands the token to a program in its arguments.
    if (!o['no-open'] && openBrowser(url) === null) out.write('No browser was opened (a snap or Flatpak browser cannot read the redirect file, or it could not be written): paste the link above into your browser.\n');
    await new Promise((done) => server.on('close', done));
    return 0;
  }
  if (cmd === 'plan' || cmd === 'apply') {
    const agents = selectedAgents(ctx, o.agents);
    if (!agents.length) { out.write('no agent found (claude, codex, gemini, copilot); the app installs none\n'); return 1; }
    if (o.level !== undefined && !LEVELS.includes(o.level)) { out.write(`--level must be one of ${LEVELS.join(', ')}\n`); return 2; }
    const found = detectLevel(ctx, agents, process.cwd());
    const level = o.level ?? found.level ?? 'full';
    if (!o.level && level !== 'full') out.write(`level ${level} (found on this machine): ${found.adds}\n`);
    const plan = preview(globalPlan({ ctx, agents, options: { packs: o.pack ?? [], packsInUse: packsInUse(ctx), level } }));
    if (!plan.length) { out.write(`nothing to change for ${agents.join(', ')}\n`); return 0; }
    if (cmd === 'plan') {
      plan.forEach((c) => show(c, out));
      out.write(`${plan.length} changes. Apply: benchkeeper apply${o.agents ? ` --agents ${o.agents}` : ''}\n`);
      return 0;
    }
    return report(apply(plan, ctx, { scope: 'global', select: await choose(plan, o, ask, out) }), out);
  }
  if (cmd === 'packs' && ['enable', 'disable'].includes(arg)) return switchPacks(ctx, { o, positionals, out, ask });
  if (cmd === 'skills') return skillsCommand(ctx, { o, positionals, out, ask });
  if (cmd === 'frameworks') {
    for (const f of frameworkRows()) out.write(`${f.id.padEnd(14)} ${f.role.padEnd(6)} ${f.kind.padEnd(7)} ${f.title} (${f.pin}): ${f.verdict} ${f.hooks}${f.limits ? ` ${f.limits}` : ''} Evaluation: ${f.evaluation}\n${f.files.map((x) => `${''.padEnd(14)} --agent-file ${x.path}: ${x.pickWhen}\n`).join('')}`);
    return 0;
  }
  if (cmd === 'packs') {
    if (arg === 'save') out.write(`saved ${savePack(ctx, { id: positionals[2], skills: o.skill ?? [] }).id}\n`);
    else if (arg === 'export') out.write(exportPack(ctx, positionals[2]));
    else if (arg === 'import') out.write(`imported ${importPack(ctx, readFileSync(positionals[2], 'utf8'), o.id).id}\n`);
    else if (arg === 'remove') { removePack(ctx, positionals[2], { usedBy: projectsUsing(ctx, positionals[2]) }); out.write(`removed ${positionals[2]}\n`); }
    else if (arg && arg !== 'list') { out.write(`unknown packs command ${arg}\n`); return 2; }
    else {
      for (const p of libraryWith(ctx).packs) out.write(`${p.id.padEnd(16)} ${p.own ? 'own    ' : 'library'} ${p.skills?.join(', ') ?? `plugin: ${Object.values(p.plugins ?? {}).map((x) => x.id).join(', ')}`}\n`);
      for (const x of invalidPacks(ctx)) out.write(`${x.file.padEnd(16)} invalid: ${x.reason} (benchkeeper packs remove ${x.file})\n`);
    }
    return 0;
  }
  if (cmd === 'projects' && (arg === 'plan' || arg === 'apply')) {
    const dir = resolve(positionals[2] ?? '.');
    if (o.share && o.local) { out.write('--share and --local exclude each other\n'); return 2; }
    const { pctx, plan, prompts, skills, warnings } = planProject(ctx, o, dir);
    if (skills.added.length || skills.removed.length) out.write(`skills: ${[...skills.added.map((n) => `+${n}`), ...skills.removed.map((n) => `-${n}`)].join(' ')}\n`);
    for (const w of warnings) out.write(`warning: ${w}\n`);
    if (arg === 'plan') {
      plan.forEach((c) => show(c, out));
      out.write(`${plan.length} changes.\n`);
    } else {
      const code = plan.length ? report(apply(plan, pctx, { scope: dir, select: await choose(plan, o, ask, out) }), out) : 0;
      if (code) return code;
    }
    out.write('Then, in an agent session the app records:\n');
    for (const p of prompts) out.write(`  benchkeeper sessions record --project ${dir} -- ${p.agent} '${p.prompt}'   (${p.why})\n`);
    return 0;
  }
  if (cmd === 'projects' && arg === 'update') {
    if (o.baseline && !['auto', ...PROFILES].includes(o.baseline)) { out.write(`--baseline must be auto, ${PROFILES.join(' or ')}\n`); return 2; }
    const max = o.max === undefined ? MAX_PROJECTS : Number(o.max);
    if (!Number.isInteger(max) || max < 1) { out.write('--max must be a whole number of at least 1\n'); return 2; }
    const asked = positionals.slice(2).map(canon), registered = listProjects(ctx);
    const unknown = positionals.slice(2).filter((_, i) => !registered.some((p) => p.path === asked[i]));
    if (unknown.length) { out.write(`${unknown.join(', ')}: not a registered project (benchkeeper projects add <dir>)\n`); return 2; }
    const projects = registered.filter((p) => !asked.length || asked.includes(p.path)).map((p) => status(ctx, p.path));
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
    if (o['dry-run']) { out.write(`dry run: ${ready.length} projects would be updated, nothing changed\n`); return 0; }
    const pushing = o['no-push'] ? 0 : pushTargets(ctx, ready.map((p) => p.path)).length;
    if (pushing > max) { out.write(`${pushing} repositories to push to: Update all pushes to at most ${max} per run (--max N raises it, --no-push stays local)\n`); return 1; }
    const shared = ready.filter((p) => p.share).length;
    const what = `${ready.length} projects: ${ready.length - shared} local in the checkout${shared ? `, ${shared} shared on branch chore/agent-setup-${appVersion}, one commit${o['no-push'] ? '' : ', git push and gh pr create where origin is on GitHub'}` : ''}`;
    if (!o.yes && !(await ask(`Update ${what}?`))) return 1;
    let results;
    try { results = updateAll(ctx, { paths: ready.map((p) => p.path), push: !o['no-push'], max }); } catch (e) { out.write(`${e.message}\n`); return 1; }
    for (const r of results) out.write(`${r.status.padEnd(12)} ${r.path}${r.pr ? `  ${r.pr}` : ''}${r.reason ? `: ${r.reason}` : ''}\n`);
    return results.some((r) => r.status === 'stopped') ? 1 : 0;
  }
  if (cmd === 'projects') {
    const dirs = positionals.slice(2);
    if (arg === 'add') dirs.forEach((d) => out.write(`added ${addProject(ctx, d, { worktree: o.worktree })}\n`));
    else if (arg === 'scan') for (const d of scan(ctx, dirs[0] ?? '.')) out.write(`found ${d}${listProjects(ctx).some((p) => p.path === canon(d)) ? ' (registered)' : `: benchkeeper projects add ${d}`}\n`);
    else if (arg === 'rename') {
      if (!dirs[0]) { out.write('projects rename needs a directory\n'); return 2; }
      renameProject(ctx, dirs[0], { name: dirs[1] ?? (o.notes === undefined ? '' : undefined), notes: o.notes });
      out.write(`renamed ${canon(dirs[0])}\n`);
    }
    else if (arg === 'relocate') {
      if (dirs.length !== 2) { out.write('projects relocate needs the old and the new directory\n'); return 2; }
      out.write(`relocated ${canon(dirs[0])} to ${relocateProject(ctx, dirs[0], dirs[1])}\n`);
    }
    else if (arg === 'remove' && o.setup) return removeSetups(ctx, dirs, { o, out, ask });
    else if (arg === 'remove') dirs.forEach((d) => { removeProject(ctx, d); out.write(`removed ${resolve(d)}\n`); });
    else if (arg === 'unshare') {
      const max = o.max === undefined ? MAX_PROJECTS : Number(o.max);
      if (!Number.isInteger(max) || max < 1) { out.write('--max must be a whole number of at least 1\n'); return 2; }
      const due = (dirs.length ? dirs.map((d) => resolve(d)) : listProjects(ctx).map((p) => p.path)).map((d) => status(ctx, d)).filter((p) => p.committed || dirs.length);
      if (!due.length) { out.write('no project carries a committed setup\n'); return 0; }
      for (const p of due) out.write(`${p.path}  setup ${p.origin ?? '-'} on origin${p.clean ? '' : ', working tree has changes: skipped'}\n`);
      const ready = due.filter((p) => p.clean);
      if (!ready.length) return 1;
      if (!o['no-push'] && ready.length > max) { out.write(`${ready.length} pull requests: at most ${max} per run (--max N raises it, --no-push stays local)\n`); return 1; }
      if (!o.yes && !(await ask(`Open ${ready.length} pull requests (branch chore/agent-setup-local)${o['no-push'] ? ' without pushing' : ''}?`))) return 1;
      const results = ready.map((p) => unshare(ctx, p.path, { push: !o['no-push'] }));
      for (const r of results) out.write(`${r.status.padEnd(12)} ${r.path}${r.pr ? `  ${r.pr}` : ''}${r.reason ? `: ${r.reason}` : ''}\n`);
      return results.some((r) => r.status === 'stopped') ? 1 : 0;
    }
    else if (arg && arg !== 'list') { out.write(`unknown projects command ${arg}\n`); return 2; }
    if (!arg || arg === 'list') for (const p of listProjects(ctx)) out.write(`${p.path}\n`);
    return 0;
  }
  if (cmd === 'insights') { out.write('insights works with --json\n'); return 2; }
  if (cmd === 'sessions' && !['board', 'record'].includes(arg)) { out.write('sessions needs board or record\n'); return 2; }
  if (cmd === 'sessions' && arg === 'board') {
    out.write('Reading the transcripts; the first run reads all of them, later runs only new or changed ones.\n');
    const rows = await scanSessions(ctx);
    const file = writeBoard(ctx, rows);
    out.write(`${rows.length} sessions: ${file}\n`);
    // A file URL carries no token: opened directly, as the CLI exits before a redirect file would be read.
    if (!o['no-open']) launch(pathToFileURL(file).href);
    return 0;
  }
  if (cmd === 'sessions') {
    const argv = positionals.slice(2);
    if (!argv.length) { out.write('sessions record needs the agent command after --\n'); return 2; }
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
    for (const r of done.refused) out.write(`refused: ${r}\n`);
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
  if (cmd === 'settings') return settingsCommand({ o, positionals, out, ask, ctx });
  if (cmd === 'knowledge') return knowledgeCommand({ o, positionals, out, ask });
  if (cmd === 'accounts') return accountsCommand(ctx, { o, positionals, out, ask });
  if (cmd === 'run') return runAccountCommand({ o, positionals, out, ctx, ask });
  if (cmd === 'rules') return rulesCommand({ o, positionals, out, ask, ctx });
  if (cmd === 'extensions') {
    if (arg && arg !== 'list') { out.write('extensions needs list\n'); return 2; }
    if (o.agent && !RULE_AGENTS.includes(o.agent)) { out.write(`agent must be one of ${RULE_AGENTS.join(', ')}\n`); return 2; }
    out.write(`${extensionLines(extensionsView(ctx, { agents: o.agent ? [o.agent] : RULE_AGENTS, dir: o.project ? resolve(o.project) : undefined })).join('\n')}\n`);
    return 0;
  }
  if (cmd === 'evals' && arg === 'cases') {
    if (positionals[2] !== 'add') { out.write('evals cases needs add\n'); return 2; }
    // A session run gives the project and transcript.
    const session = o.run ? ctx.ledger.get(o.run) : null;
    const r = addCase(ctx, { target: o.target?.[0], scope: o.scope, expected: o.expected, should: !o['should-not'], run: o.run, query: o.query, description: o.description,
      project: o.project ? resolve(o.project) : session?.scope, transcript: o.transcript ? resolve(o.transcript) : session?.entries[0]?.transcript ?? undefined });
    out.write(`case ${r.case.id} for ${r.target} in ${r.path}\nquery: ${r.case.query.split('\n')[0].slice(0, 120)}\nrun ${r.run}: undo with benchkeeper undo ${r.run}\n`);
    return 0;
  }
  if (cmd === 'verify') {
    const checks = harnessTest(ctx, { agents: selectedAgents(ctx, o.agents), dir: arg ? resolve(arg) : undefined });
    if (o.json) return testJson(checks, out);
    for (const c of checks) out.write(`${c.ok ? 'ok  ' : 'fail'}  ${c.name}${c.problems.map((p) => `\n      ${p}`).join('')}\n`);
    return checks.every((c) => c.ok) ? 0 : 1;
  }
  if (cmd === 'evals') {
    if (arg !== 'plan' && arg !== 'run') { out.write('evals needs plan, run or cases add\n'); return 2; }
    if (arg === 'run' && process.env.CI) { out.write('evals run starts agent sessions on a subscription and does not run in CI\n'); return 2; }
    const plan = evalPlan(ctx, { agents: o.agents?.split(',') ?? ['claude'], model: o.model, all: o.all, only: o.target });
    const sessions = plan.reduce((n, p) => n + p.cases.length, 0);
    if (!plan.length) { out.write('every target is unchanged since its last result (--all runs them again)\n'); return 0; }
    for (const p of plan) out.write(`${p.target}  ${p.agent}${p.model ? ` ${p.model}` : ''}  ${p.cases.length} cases${p.project ? `  (project ${p.project})` : ''}\n`);
    if (arg === 'plan') return 0;
    if (!o.yes && !(await ask(`Start ${sessions} agent sessions?`))) return 1;
    for (const r of await runEval(ctx, plan)) {
      const pct = (x) => (x == null ? '-' : `${Math.round(x * 100)}%`);
      const review = r.details.find((d) => d.review)?.review;
      out.write(`${r.target}  ${r.agent} ${r.agentVersion}${r.model ? ` ${r.model}` : ''}  miss ${pct(r.missRate)}  false trigger ${pct(r.falseTriggerRate)}${review ? `  review: ${review.slice(0, review.lastIndexOf('/') + 1)}` : ''}\n`);
    }
    return 0;
  }
  if (cmd === 'history') {
    for (const r of ctx.ledger.list()) {
      const note = r.note?.case ? ` (eval case ${r.note.case} for ${r.note.target}${r.note.run ? `, from ${r.note.run}` : ''})` : r.kind === 'session' ? ` (a miss: benchkeeper evals cases add --run ${r.id} --target ... --expected ...)` : '';
      out.write(`${r.id}  ${r.kind.padEnd(7)} ${(r.status ?? 'interrupted').padEnd(11)} ${r.scope}  ${r.entries.length} changes${r.of ? ` (undo of ${r.of})` : ''}${note}\n`);
    }
    for (const b of legacyBackups(ctx)) out.write(`${b}  setup.sh backup: benchkeeper restore ${b}\n`);
    return 0;
  }
  if (cmd === 'undo' || cmd === 'restore') {
    if (!arg) { out.write(`${cmd} needs a name, see benchkeeper history\n`); return 2; }
    if (cmd === 'restore') {
      // Files written into the home folder from a backup: listed, and asked once unless --yes.
      if (!legacyBackups(ctx).includes(arg)) { out.write(`no setup.sh backup ${arg}, see benchkeeper history\n`); return 1; }
      const files = listFiles(join(ctx.ledger.backups, arg));
      files.forEach((f) => out.write(`restore ${f}\n`));
      if (!o.yes && !(await ask(`Restore ${files.length} files into ${ctx.home}?`))) return 1;
      return report(restoreLegacy(arg, ctx), out);
    }
    let uctx;
    try { uctx = scopeCtx(ctx, ctx.ledger.get(arg).scope); } catch (e) { out.write(`${e.message}\n`); return 1; }
    return report(undo(arg, uctx, { step: o.step }), out);
  }
  out.write(`unknown command ${cmd}\n\n${HELP}\n`);
  return 2;
}

// extra: more answers (packOn, reset, ...); focus: skill names, the plan then holds only their changes.
function planProject(ctx, o, dir, { focus, ...extra } = {}) {
  const pctx = projectCtx(ctx, dir);
  const answers = { agents: o.agents?.split(','), env: o.env, sandbox: o.sandbox, share: o.share ? true : o.local ? false : undefined, packs: o.pack, skills: o.skill, tier: o.tier, callers: o.caller, frameworks: o.framework?.filter((f) => f !== 'none'), agentFiles: o['agent-file'], ...extra };
  const { changes, prompts, skills, warnings } = projectPlan({ ctx: pctx, dir, answers, plugins: installedPlugins(ctx) });
  return { pctx, plan: preview(focus ? focusOn(changes, focus) : changes), prompts, skills, warnings };
}

// The plan of one folder, shown and applied the way projects apply does; the plugin installs of a pack stay with the global plan.
async function runProjectPlan(ctx, dir, { o, out, ask }, planned) {
  const { pctx, plan, skills, warnings } = planned;
  if (skills.added.length || skills.removed.length) out.write(`skills: ${[...skills.added.map((n) => `+${n}`), ...skills.removed.map((n) => `-${n}`)].join(' ')}\n`);
  for (const w of warnings) out.write(`warning: ${w}\n`);
  if (!plan.length) { out.write('nothing to change\n'); return 0; }
  return report(apply(plan, pctx, { scope: dir, select: await choose(plan, o, ask, out) }), out);
}

// packs enable|disable: a plan on top of the current state; nothing new is stored. --global: the plugin of a pack that has one.
async function switchPacks(ctx, { o, positionals, out, ask }) {
  const on = positionals[1] === 'enable', ids = positionals.slice(2);
  if (!ids.length) { out.write(`packs ${positionals[1]} needs a pack id, see benchkeeper packs list\n`); return 2; }
  if (o.global && o.project) { out.write('--project and --global exclude each other\n'); return 2; }
  const known = libraryWith(ctx).packs;
  const unknown = ids.filter((id) => !known.some((p) => p.id === id));
  if (unknown.length) { out.write(`unknown pack ${unknown.join(', ')}, see benchkeeper packs list\n`); return 1; }
  if (!o.global) {
    const dir = resolve(o.project ?? '.');
    if (!tryState(dir)) { out.write(`${dir} has no setup yet: benchkeeper projects apply --agents a,b --pack ${ids[0]}\n`); return 1; }
    return runProjectPlan(ctx, dir, { o, out, ask }, planProject(ctx, o, dir, on ? { packOn: ids } : { packOff: ids }));
  }
  const skillsOnly = ids.filter((id) => !known.find((p) => p.id === id).plugins);
  if (skillsOnly.length) { out.write(`${skillsOnly.join(', ')} install library skills per project, not on the machine: use --project <dir>\n`); return 1; }
  const agents = selectedAgents(ctx, o.agents), have = installedPacks(ctx);
  const steps = new Set(Object.entries(PLUGINS).flatMap(([a, list]) => list.filter((p) => ids.includes(p.pack)).map((p) => `plugin:${a}:${p.id}`)));
  // The other installed packs stay as they are; the pack asked for is the only one on or off.
  const packs = on ? [...new Set([...have, ...ids])] : have.filter((p) => !ids.includes(p));
  const plan = preview(globalPlan({ ctx, agents, options: { packs, packsInUse: [], level: 'full' } })).filter((c) => steps.has(c.step)).map((c) => ({ ...c, selected: true }));
  for (const id of on ? [] : ids) { const users = projectsUsing(ctx, id); if (users.length) out.write(`note: ${users.join(', ')} still name${users.length === 1 ? 's' : ''} ${id}\n`); }
  if (!plan.length) { out.write('nothing to change\n'); return 0; }
  return report(apply(plan, ctx, { scope: 'global', select: await choose(plan, o, ask, out) }), out);
}

const SKILL_ACTIONS = ['update', 'reset', 'remove', 'adopt', 'enable', 'disable'];
// skills list|update|reset|remove|adopt|enable|disable: the Catalog's skill management, through the same plan, diff and undo.
async function skillsCommand(ctx, { o, positionals, out, ask }) {
  const [, sub = 'list', ...names] = positionals;
  const dir = resolve(o.project ?? '.');
  if (sub !== 'list' && !SKILL_ACTIONS.includes(sub)) { out.write(`skills needs list, ${SKILL_ACTIONS.join(', ')}\n`); return 2; }
  // list --check and update without names ask each source's default branch; update with names re-adds those skills.
  const rows = projectSkills(ctx, dir, { check: o.check || (sub === 'update' && !names.length) });
  if (sub === 'list') {
    for (const s of rows?.skills ?? []) out.write(`${s.name.padEnd(30)} ${s.state.padEnd(9)} ${s.own ? 'BenchKeeper' : `${s.pinned?.slice(0, 12) ?? 'not installed'} (source ${s.newest?.slice(0, 12) ?? 'not checked'})`}${s.packs.length ? `  pack ${s.packs.join(', ')}` : ''}${s.single ? '  single pick' : ''}\n`);
    for (const u of rows?.untracked ?? []) out.write(`${u.name.padEnd(30)} untracked ${u.folders.join(', ')}${u.library ? `  (benchkeeper skills adopt ${u.name})` : ''}\n`);
    for (const u of globalUntracked(ctx, selectedAgents(ctx, o.agents))) out.write(`${u.name.padEnd(30)} untracked global ${u.folders.join(', ')}\n`);
    if (!rows) out.write(`${dir} has no setup yet\n`);
    return 0;
  }
  if (!rows) { out.write(`${dir} has no setup yet: benchkeeper projects apply --agents a,b\n`); return 1; }
  if (['enable', 'disable'].includes(sub) && !names.length) { out.write(`skills ${sub} needs a skill name\n`); return 2; }
  let action;
  try { action = skillAction(rows, sub, names); } catch (e) { out.write(`${e.message}\n`); return 1; }
  if (!action.names.length) { out.write('nothing to change\n'); return 0; }
  return runProjectPlan(ctx, dir, { o, out, ask }, planProject(ctx, o, dir, { ...action.answers, focus: action.names, partial: true }));
}

// ---- --json: one document on stdout, logs on stderr. Exit 0 clean, 1 findings of level error, 2 usage or read failure.
// A document never holds file contents or values of environment variables: changes list title, kind and path, not the diff.

export const JSON_SCHEMA_VERSION = 1;
const FINDING_KEYS = ['level', 'tag', 'check', 'message', 'fix', 'dir', 'file', 'line', 'scope', 'rule', 'repos'];
const finding = (i) => Object.fromEntries(FINDING_KEYS.filter((k) => i[k] !== undefined).map((k) => [k, i[k]]));
const changeDoc = (c) => ({ id: c.id, step: c.step, title: c.title, kind: c.kind, destructive: !!c.destructive, optional: !!c.optional, selected: !!c.selected, ...(c.path ? { path: c.path } : {}), ...(c.argv ? { argv: c.argv } : {}), ...(c.error ? { error: redact(c.error) } : {}) });
const jsonDoc = (command, doc) => `${JSON.stringify({ schemaVersion: JSON_SCHEMA_VERSION, command, ...doc }, null, 2)}\n`;
function testJson(checks, out) {
  const ok = checks.every((c) => c.ok);
  out.write(jsonDoc('verify', { ok, checks: checks.map((c) => ({ name: c.name, ok: c.ok, problems: c.problems })) }));
  return ok ? 0 : 1;
}
// The name a document carries: the command, with its subcommand where the table lists one.
const commandName = (cmd, arg) => (['projects', 'packs', 'skills', 'rules', 'extensions', 'settings', 'frameworks', 'profile', 'accounts', 'knowledge', 'sessions', 'evals'].includes(cmd) ? `${cmd} ${arg ?? 'list'}` : cmd);
const count = (list, level) => list.filter((i) => i.level === level).length;

async function jsonCommand({ cmd, arg, o, positionals, out, err, ctx }) {
  const name = commandName(cmd, arg);
  const emit = (doc, code = 0) => { out.write(jsonDoc(name, doc)); return code; };
  const fail = (message) => { err.write(`${redact(message)}\n`); return emit({ error: redact(message) }, 2); };
  // listProjects reads a broken registry as empty, so a document built from it would pass for a real result.
  const registryFail = () => { const problem = registryProblem(ctx); return problem ? fail(problem) : undefined; };
  // The list commands take no more positional arguments than they read.
  const surplus = (n) => (positionals.length > n ? fail(`unexpected argument ${positionals[n]}`) : undefined);
  if (cmd === 'doctor') {
    if (o.baseline && !['auto', ...PROFILES].includes(o.baseline)) return fail(`--baseline must be auto, ${PROFILES.join(' or ')}`);
    const broken = registryFail();
    if (broken !== undefined) return broken;
    const agents = selectedAgents(ctx, o.agents), dir = resolve(arg ?? '.');
    const { level, adds } = detectLevel(ctx, agents, dir);
    const found = doctor(ctx, { agents, dir, baseline: o.baseline && { profile: o.baseline, ref: o['baseline-ref'] } });
    return emit({ level: level ?? null, adds: adds ?? null, findings: found.map(finding), summary: { error: count(found, 'error'), warning: count(found, 'warning'), info: count(found, 'info') } }, count(found, 'error') ? 1 : 0);
  }
  if (cmd === 'plan') {
    const agents = selectedAgents(ctx, o.agents);
    if (!agents.length) return fail('no agent found (claude, codex, gemini, copilot); the app installs none');
    if (o.level !== undefined && !LEVELS.includes(o.level)) return fail(`--level must be one of ${LEVELS.join(', ')}`);
    const broken = registryFail();
    if (broken !== undefined) return broken;
    const level = o.level ?? detectLevel(ctx, agents, process.cwd()).level ?? 'full';
    const plan = preview(globalPlan({ ctx, agents, options: { packs: o.pack ?? [], packsInUse: packsInUse(ctx), level } }));
    return emit({ agents, level, changes: plan.map(changeDoc) }, plan.some((c) => c.error) ? 1 : 0);
  }
  if (cmd === 'projects' && arg === 'plan') {
    if (o.share && o.local) return fail('--share and --local exclude each other');
    const dir = resolve(positionals[2] ?? '.');
    const { plan, skills, warnings } = planProject(ctx, o, dir);
    return emit({ dir, changes: plan.map(changeDoc), skills, warnings }, plan.some((c) => c.error) ? 1 : 0);
  }
  if (cmd === 'history') {
    const runs = ctx.ledger.list().map((r) => ({ id: r.id, kind: r.kind, status: r.status ?? 'interrupted', scope: r.scope, time: r.time, changes: r.entries.length, ...(r.of ? { of: r.of } : {}), ...(r.note?.case ? { evalCase: r.note.case, target: r.note.target } : {}) }));
    return emit({ runs, backups: legacyBackups(ctx) });
  }
  if (cmd === 'projects' && (!arg || arg === 'list')) return surplus(2) ?? registryFail() ?? emit({ projects: listProjects(ctx).map((p) => ({ path: p.path, added: p.added })) });
  if (cmd === 'packs' && (!arg || arg === 'list')) return surplus(2) ?? emit({ packs: libraryWith(ctx).packs.map((p) => ({ id: p.id, own: !!p.own, skills: p.skills ?? [], plugins: Object.values(p.plugins ?? {}).map((x) => x.id) })) });
  if (cmd === 'skills' && (!arg || arg === 'list')) {
    const extra = surplus(2); if (extra !== undefined) return extra;
    const dir = resolve(o.project ?? '.'), rows = projectSkills(ctx, dir, { check: o.check });
    return emit({ dir, hasSetup: !!rows, skills: rows?.skills ?? [], untracked: rows?.untracked ?? [], globalUntracked: globalUntracked(ctx, selectedAgents(ctx, o.agents)) });
  }
  if (cmd === 'rules' && arg === 'list') {
    const extra = surplus(2); if (extra !== undefined) return extra;
    if (o.agent && !RULE_AGENTS.includes(o.agent)) return fail(`agent must be one of ${RULE_AGENTS.join(', ')}`);
    const found = selectedAgents(ctx, o.agents).filter((a) => RULE_AGENTS.includes(a));
    return emit(rulesView(ctx, { agents: o.agent ? [o.agent] : found.length ? found : RULE_AGENTS, dir: o.project ? resolve(o.project) : undefined }));
  }
  if (cmd === 'extensions' && (!arg || arg === 'list')) {
    const extra = surplus(2); if (extra !== undefined) return extra;
    if (o.agent && !RULE_AGENTS.includes(o.agent)) return fail(`agent must be one of ${RULE_AGENTS.join(', ')}`);
    return emit(extensionsView(ctx, { agents: o.agent ? [o.agent] : RULE_AGENTS, dir: o.project ? resolve(o.project) : undefined }));
  }
  if (cmd === 'settings' && (arg === 'list' || arg === 'get')) {
    const agent = o.agent ?? 'claude', key = positionals[2];
    const extra = surplus(arg === 'get' ? 3 : 2); if (extra !== undefined) return extra;
    if (!settingsAgents.includes(agent)) return fail(`agent must be one of ${settingsAgents.join(', ')}`);
    if (arg === 'get' && !key) return fail('settings get needs a key');
    const l = listSettings(ctx, agent, { dir: o.project ? resolve(o.project) : undefined, advanced: arg === 'get' || !!o.advanced, env: process.env });
    // Values of environment variables never appear: the env block and the env.* keys carry names only.
    const bare = (x) => (x.key === 'env' || String(x.key).startsWith('env.') ? { ...x, value: undefined, appValue: undefined, ...(x.sets ? { sets: x.sets.map(({ value, ...set }) => set) } : {}) } : x);
    const doc = { ...l, settings: l.settings.map(bare), ...(l.advanced ? { advanced: l.advanced.map(bare), outside: l.outside.map(bare) } : {}), ...(l.env ? { env: l.env.map(({ value, ...e }) => e) } : {}),
      // A parse error can quote the file: the document says only that the file failed.
      layers: l.layers.map((f) => (f.error ? { ...f, error: 'the file does not parse' } : f)) };
    // An env object at any depth (the env block, an MCP server's env) is reduced to its names.
    const scrub = (v) => JSON.parse(JSON.stringify(v, (k, x) => (k === 'env' && x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x) : x)));
    if (arg === 'list') return emit(scrub(doc));
    const setting = [...doc.settings, ...(doc.advanced ?? [])].find((x) => x.key === key);
    return setting ? emit({ agent, setting: scrub(setting) }) : fail(`${key} is not a key of ${l.name}'s reference or schema`);
  }
  if (cmd === 'frameworks' && (!arg || arg === 'list')) return surplus(2) ?? emit({ frameworks: frameworkRows() });
  if (cmd === 'projects' && arg === 'scan') {
    const extra = surplus(3); if (extra !== undefined) return extra;
    const broken = registryFail();
    if (broken !== undefined) return broken;
    const registered = listProjects(ctx).map((p) => p.path);
    return emit({ root: canon(positionals[2] ?? '.'), found: scan(ctx, positionals[2] ?? '.').map((path) => ({ path, registered: registered.includes(canon(path)) })) });
  }
  if (cmd === 'sessions' && arg === 'board') {
    const extra = surplus(2); if (extra !== undefined) return extra;
    // Nothing is written or opened; the title is left out because it quotes the first message of a session.
    const sessions = (await scanSessions(ctx)).map(({ title, ...s }) => s);
    return emit({ sessions });
  }
  if (cmd === 'insights') {
    const extra = surplus(1); if (extra !== undefined) return extra;
    const broken = registryFail();
    if (broken !== undefined) return broken;
    const found = await collectInsights(ctx, { agents: selectedAgents(ctx, o.agents), dir: o.project && resolve(o.project) });
    return emit(found, found.summary.error ? 1 : 0);
  }
  if (cmd === 'knowledge') {
    if (arg !== 'show') return fail('knowledge --json works with show');
    const extra = surplus(3); if (extra !== undefined) return extra;
    const dir = resolve(positionals[2] ?? '.');
    return emit({ dir, ...readKnowledge(dir) });
  }
  if (cmd === 'accounts' && (!arg || ['list', 'status'].includes(arg))) {
    const extra = surplus(arg ? 3 : 2); if (extra !== undefined) return extra;
    const problem = accountsProblem(ctx);
    if (problem) return fail(problem);
    const all = listAccounts(ctx), picked = positionals[2] ? all.filter((a) => a.name === positionals[2]) : all;
    if (positionals[2] && !picked.length) return fail(`no account ${positionals[2]}`);
    if (arg !== 'status') return emit({ accounts: picked.map((a) => accountDoc(a, registrySettings(ctx))), settings: { ...settingsOf(registrySettings(ctx)), warn: limitsFor(registrySettings(ctx)).warn } });
    const accounts = picked.map((a) => accountStatus(ctx, a, { dir: o.project ? resolve(o.project) : undefined }));
    return emit({ accounts }, accounts.some((a) => a.findings.some((f) => f.level === 'error')) ? 1 : 0);
  }
  if (cmd === 'profile' && arg === 'export') {
    if (positionals[2]) return fail('profile export --json prints the document: redirect stdout and take `.profile` before profile import');
    const broken = registryFail();
    if (broken !== undefined) return broken;
    return emit({ profile: JSON.parse(exportProfile(ctx, { agents: selectedAgents(ctx, o.agents), packs: installedPacks(ctx) })) });
  }
  return fail('--json works with doctor, verify, plan, projects plan, history, projects list and scan, packs list, skills list, rules list, extensions list, settings list and get, frameworks list, sessions board, insights, profile export, knowledge show and accounts list and status');
}

const show1 = (v) => (v === undefined ? '-' : typeof v === 'string' ? v : JSON.stringify(v));

// settings list|get|set: the editor of the UI on the command line, through the same plan, diff and undo.
async function settingsCommand({ o, positionals, out, ask, ctx }) {
  const [, sub, key, ...rest] = positionals;
  const agentId = o.agent ?? 'claude';
  if (!settingsAgents.includes(agentId)) { out.write(`agent must be one of ${settingsAgents.join(', ')}\n`); return 2; }
  const dir = o.project ? resolve(o.project) : undefined;
  const view = () => listSettings(ctx, agentId, { dir, advanced: key === undefined ? !!o.advanced : true, env: process.env });
  const noteLines = (notes) => notes.forEach((n) => out.write(`  ${n.level}: ${n.message} (${n.source})\n`));
  if (sub === 'list') {
    const l = view();
    for (const f of l.layers) out.write(`${f.layer.padEnd(8)} ${f.path}${f.exists ? '' : ' (missing)'}${f.error ? ` (unreadable: ${f.error})` : ''}${f.readOnly ? ' (read-only)' : ''}\n`);
    for (const s of l.settings) {
      out.write(`${s.key.padEnd(44)} ${s.layer ? `${show1(s.value)} (${s.layer})` : `default: ${s.default}`}\n`);
      noteLines(s.notes);
    }
    for (const a of l.advanced ?? []) if (a.changed || o.advanced) out.write(`${a.key.padEnd(44)} ${a.layer ? `${show1(a.value)} (${a.layer})` : '-'}\n`);
    for (const x of l.outside ?? []) out.write(`${x.key.padEnd(44)} ${show1(x.value)} (${x.layer}, not in the app's list, kept)\n`);
    for (const e of l.env ?? []) out.write(`env.${e.name.padEnd(40)} ${show1(e.value)} (${e.layer})\n`);
    return 0;
  }
  if (sub === 'get') {
    if (!key) { out.write('settings get needs a key\n'); return 2; }
    const l = view();
    const s = [...l.settings, ...(l.advanced ?? [])].find((x) => x.key === key);
    if (!s) { out.write(`${key} is not a key of ${l.name}'s reference or schema\n`); return 1; }
    out.write(`${show1(s.value)}${s.layer ? ` (${s.layer})` : `  (unset; default: ${s.default ?? 'built-in'})`}\n`);
    for (const x of s.sets ?? []) out.write(`  ${x.layer}: ${show1(x.value)}\n`);
    noteLines(s.notes ?? []);
    return 0;
  }
  if (sub !== 'set') { out.write('settings needs list, get or set\n'); return 2; }
  const layer = o.layer ?? 'user';
  let edits;
  try {
    if (o.bundle) edits = bundleEdits(agentId, o.bundle);
    else {
      if (!key) { out.write('settings set needs a key and a value, or --unset, or --bundle\n'); return 2; }
      const def = describeKey(agentId, key) ?? (agentId === 'codex' && key.startsWith('projects.') ? { key, type: 'any' } : null);
      if (!def) { out.write(`${key} is not a key of the ${agentId} reference or schema\n`); return 1; }
      if (o.unset) edits = { [key]: null };
      else if (rest.length === 0 && def.type !== 'switch') { out.write(`settings set ${key} needs a value or --unset\n`); return 2; }
      else edits = { [key]: parseInput(def, rest.length ? rest.join(' ') : 'set') };
    }
  } catch (e) { out.write(`${e.message}\n`); return 2; }
  let plan;
  try {
    const changes = settingsChanges(ctx, agentId, { layer, dir, edits });
    plan = preview(changes);
  } catch (e) { out.write(`${e.message}\n`); return 1; }
  if (!plan.length) { out.write('nothing to change\n'); return 0; }
  const sctx = layer === 'user' ? ctx : projectCtx(ctx, dir);
  return report(apply(plan, sctx, { scope: layer === 'user' ? 'global' : dir, select: await choose(plan, o, ask, out) }), out);
}

// knowledge show|clear: the knowledge base of the maintaining-repos skill, per project folder.
async function knowledgeCommand({ o, positionals, out, ask }) {
  const [, sub, where] = positionals;
  if (!['show', 'clear'].includes(sub)) { out.write('knowledge needs show or clear\n'); return 2; }
  if (positionals.length > 3) { out.write(`unexpected argument ${positionals[3]}\n`); return 2; }
  const dir = resolve(where ?? '.');
  if (sub === 'clear' && linkedParent(dir)) { out.write(`${join(dir, '.benchkeeper')} is a link: nothing removed\n`); return 1; }
  let found;
  try { found = readKnowledge(dir); } catch (e) { out.write(`cannot read ${knowledgeDir(dir)}: ${e.code ?? e.message}\n`); return 2; }
  const { path, present, files, ignored } = found;
  if (!present && !ignored.length) { out.write(`no knowledge stored for ${dir}\n`); return 0; }
  if (sub === 'show') {
    if (!files.length && !ignored.length) out.write('the knowledge folder is empty\n');
    for (const f of files) out.write(`${f.name}  ${f.entries.length} entries\n${f.entries.map((e) => `  ${entryLine(e)}\n`).join('')}`);
    for (const i of ignored) out.write(`ignored ${i.name}: ${i.reason}\n`);
    return 0;
  }
  const n = files.reduce((sum, f) => sum + f.entries.length, 0);
  if (!o.yes && !(await ask(`Remove ${path} (${n} entries in ${files.length} files${ignored.length ? `, ${ignored.length} ignored` : ''})?`))) return 1;
  clearKnowledge(dir);
  out.write(`removed ${path}\n`);
  return 0;
}

// rules list|disable|enable: the Rules view on the command line, through the same plan, diff and undo.
async function rulesCommand({ o, positionals, out, ask, ctx }) {
  const [, sub, file] = positionals;
  if (!['list', 'disable', 'enable'].includes(sub)) { out.write('rules needs list, disable or enable\n'); return 2; }
  if (o.agent && !RULE_AGENTS.includes(o.agent)) { out.write(`agent must be one of ${RULE_AGENTS.join(', ')}\n`); return 2; }
  const dir = o.project ? resolve(o.project) : undefined;
  if (sub === 'list') {
    const found = selectedAgents(ctx, o.agents).filter((a) => RULE_AGENTS.includes(a));
    for (const a of rulesView(ctx, { agents: o.agent ? [o.agent] : found.length ? found : RULE_AGENTS, dir }).agents) {
      out.write(`${a.name}\n`);
      for (const r of a.rows) out.write(`  ${r.scope.padEnd(8)} ${r.owner.padEnd(12)} ${(r.load + (r.by ? ` (${r.by})` : '')).padEnd(24)} ${String(r.tokens).padStart(6)} tokens  ${r.shown}\n`);
      const b = a.budget;
      out.write(`  at the start of a session: about ${b.total} tokens (bytes / 4)${b.largest ? `, largest ${b.largest.label} with ${b.largest.tokens}` : ''}${b.over ? `, over ${b.threshold}` : ''}\n`);
      for (const n of b.notes) out.write(`  note: ${n}\n`);
    }
    return 0;
  }
  if (!file) { out.write(`rules ${sub} needs a file\n`); return 2; }
  let plan;
  try { plan = preview(ruleChanges(ctx, { agent: o.agent, file: resolve(file), dir, on: sub === 'enable' })); } catch (e) { out.write(`${e.message}\n`); return 1; }
  if (!plan.length) { out.write('nothing to change\n'); return 0; }
  const rctx = dir ? projectCtx(ctx, dir) : ctx;
  return report(apply(plan, rctx, { scope: dir ?? 'global', select: await choose(plan, o, ask, out) }), out);
}

// ---- accounts: the registry, the guided sign-in and the launcher (accounts.mjs)

const accountLine = (a) => `${a.name.padEnd(16)} ${a.agent.padEnd(7)} ${(a.mode === 'host' ? 'host' : 'container').padEnd(9)} ${(a.default ? 'default' : '').padEnd(8)} ${a.mode === 'host' ? a.dir : `volume ${a.volume} at ${a.mount}`}${a.label ? `  ${mask(a.label)}` : ''}${a.pool ? `  pool ${a.pool}` : ''}${a.token ? `  token kept since ${a.token.created.slice(0, 10)}` : ''}`;

// The steps of a sign-in as the terminal shows them; the agent's own lines come through say.
function terminalIo({ out, ask, secret }) {
  return {
    say: (line) => out.write(`  ${line}\n`),
    step: (name) => { if (name === 'code') out.write('  If the browser shows a code, paste it here and press Enter; otherwise wait.\n'); if (name === 'verify') out.write('  Checking the sign-in.\n'); },
    code: () => ask.line(''),
    secret: () => secret,
  };
}

async function signIn(ctx, a, { o, out, ask }) {
  const dir = resolve(o.project ?? '.');
  let secret;
  if (o.token && a.agent === 'codex') {
    // Never an argument and never typed with an echo: the token comes from a pipe.
    if (ask.tty) { out.write('pipe the access token on stdin: printenv NAME | benchkeeper accounts login <name> --token\n'); return 2; }
    secret = ((await ask.line('')) ?? '').trim();
  }
  if (o.token && a.agent === 'claude') { try { store(ctx).has(a.name); } catch (e) { out.write(`${e.message}\n`); return 1; } }
  out.write(`Signing in ${a.name} (${a.agent}${a.mode === 'host' ? `, folder ${a.dir}` : `, dev container volume ${a.volume}`})${o.token ? ', token' : ''}.\n`);
  try {
    const r = await login(ctx, a, { io: terminalIo({ out, ask, secret }), token: !!o.token, email: o.email, noBrowser: !!o['no-browser'], dir });
    if (r.stored) {
      const run = commit(ctx, tokenChange(ctx, a.name, new Date().toISOString()));
      out.write(`token kept in the OS credential store (${store(ctx).name}), recorded in accounts.json without its value (run ${run.id})\n`);
    }
  } catch (e) { out.write(`${e.message}\n`); return 1; }
  out.write(`${a.name}: signed in\n`);
  return 0;
}

// The usage of an account as `accounts status` shows it: what is left per window, or why that is not known.
function usageText(u, name) {
  if (!u.tracked) return `  usage    not tracked: benchkeeper accounts track ${name}`;
  const age = u.ageSeconds < 90 ? `${u.ageSeconds} seconds` : u.ageSeconds < 5400 ? `${Math.round(u.ageSeconds / 60)} minutes` : `${Math.round(u.ageSeconds / 3600)} hours`;
  return `  usage    ${WINDOWS.map(([k, label]) => `${label} ${u[k].state === 'unknown' ? `unknown (${u[k].reason})` : `${u[k].remaining}% left, resets ${u[k].resetsAt.slice(0, 16).replace('T', ' ')} UTC`}`).join('; ')}; read ${age} ago`;
}

const percent = (v, flag) => {
  const n = Number(v);
  if (v === '' || !Number.isFinite(n) || n < 0 || n > 100) throw new Error(`${flag} is a percentage from 0 to 100`);
  return n;
};
const onOff = (v, flag) => {
  if (v !== 'on' && v !== 'off') throw new Error(`${flag} is on or off`);
  return v === 'on';
};
// The flags of `accounts limits` as the change takes them; names the flags that only work with or without an account name.
function limitFlags(o, name) {
  const minimum = {}, warn = {}, out = { minimum, warn };
  if (o['five-hour'] !== undefined) minimum.fiveHour = percent(o['five-hour'], '--five-hour');
  if (o['seven-day'] !== undefined) minimum.sevenDay = percent(o['seven-day'], '--seven-day');
  if (o['warn-five-hour'] !== undefined) warn.fiveHour = percent(o['warn-five-hour'], '--warn-five-hour');
  if (o['warn-seven-day'] !== undefined) warn.sevenDay = percent(o['warn-seven-day'], '--warn-seven-day');
  if (o.pool !== undefined) out.pool = o.pool === 'none' ? null : o.pool;
  if (o['auto-pick'] !== undefined) out.autoPick = onOff(o['auto-pick'], '--auto-pick');
  if (o['continue-below'] !== undefined) out.continueBelow = onOff(o['continue-below'], '--continue-below');
  if (o['when-none'] !== undefined) {
    if (!['stop', 'wait'].includes(o['when-none'])) throw new Error('--when-none is stop or wait');
    out.whenNone = o['when-none'];
  }
  if (name && ['autoPick', 'continueBelow', 'whenNone'].some((k) => out[k] !== undefined)) throw new Error('--auto-pick, --when-none and --continue-below are settings for all accounts: leave out the account name');
  if (!name && (out.pool !== undefined || o.reset)) throw new Error('--pool and --reset belong to one account: give its name');
  out.reset = !!o.reset;
  return out;
}
const limitsShown = (ctx) => {
  const settings = registrySettings(ctx), all = settingsOf(settings), l = limitsFor(settings);
  const text = (x) => WINDOWS.map(([k, label]) => `${label} ${x.minimum[k]}% (notice below ${x.warn[k]}%)`).join(', ');
  return [`defaults: minimum headroom ${text(l)}`,
    `auto-pick ${all.autoPick ? 'on' : 'off'}; when no pool member has headroom: ${all.whenNone}; below the minimum run ${all.continueBelow ? 'starts anyway' : 'asks'}`,
    ...listAccounts(ctx).filter((a) => a.limits || a.pool).map((a) => `${a.name}: ${a.limits ? `minimum headroom ${text(limitsFor(settings, a))}` : 'defaults'}${a.pool ? `; pool ${a.pool}` : ''}`)];
};

async function accountsCommand(ctx, { o, positionals, out, ask }) {
  const [, sub = 'list', name] = positionals;
  const subs = ['list', 'add', 'use', 'remove', 'status', 'login', 'track', 'limits'];
  if (!subs.includes(sub)) { out.write(`accounts needs ${subs.join(', ')}\n`); return 2; }
  if (positionals.length > 3) { out.write(`unexpected argument ${positionals[3]}\n`); return 2; }
  const problem = accountsProblem(ctx);
  if (problem) { out.write(`${problem}\n`); return 2; }
  const need = () => { if (!name) { out.write(`accounts ${sub} needs an account name, see benchkeeper accounts list\n`); return false; } return true; };
  try {
    if (sub === 'list') {
      const list = listAccounts(ctx);
      for (const a of list) out.write(`${accountLine(a)}\n`);
      if (!list.length) out.write('no accounts: benchkeeper accounts add\n');
      return 0;
    }
    if (sub === 'status') {
      const list = name ? [findAccount(ctx, name)] : listAccounts(ctx);
      let code = 0;
      for (const a of list) {
        const s = accountStatus(ctx, a, { dir: o.project ? resolve(o.project) : undefined });
        out.write(`${a.name.padEnd(16)} ${a.agent.padEnd(7)} ${s.loggedIn === null ? 'not checked' : s.loggedIn ? `signed in${s.method ? ` (${s.method})` : ''}` : 'not signed in'}${s.tokenAgeDays !== undefined ? `  token ${s.tokenAgeDays} days old` : ''}\n`);
        if (s.usage) out.write(`${usageText(s.usage, a.name)}\n`);
        for (const f of s.findings) { out.write(`  ${f.level.padEnd(8)} ${f.message}\n           fix: ${f.fix}\n`); if (f.level === 'error') code = 1; }
      }
      return code;
    }
    if (sub === 'login') {
      if (!need()) return 2;
      return await signIn(ctx, findAccount(ctx, name), { o, out, ask });
    }
    if (sub === 'track') {
      if (!need()) return 2;
      return await trackAccount(ctx, findAccount(ctx, name), { o, out, ask });
    }
    let change, entry, gone;
    if (sub === 'limits') {
      const flags = limitFlags(o, name), given = Object.values({ ...flags.minimum, ...flags.warn }).length || ['pool', 'autoPick', 'whenNone', 'continueBelow'].some((k) => flags[k] !== undefined) || flags.reset;
      if (name) findAccount(ctx, name);
      if (!given) { limitsShown(ctx).forEach((l) => out.write(`${l}\n`)); return 0; }
      change = name ? limitsChange(ctx, name, flags) : settingsChange(ctx, flags);
    } else if (sub === 'add') {
      // What is missing is asked, as the Accounts page does step by step; with --yes it is a usage error.
      const asked = !name || !o.agent;
      const pick = async (value, question) => value ?? (o.yes ? undefined : ((await ask.line(question)) ?? '').trim() || undefined);
      const n = await pick(name, 'Account name: '), agent = await pick(o.agent, `Agent (${AGENTS.join(' or ')}): `);
      const container = o.container ?? (asked && !o.yes ? await ask('Run it in a dev container (a named volume)?') : false);
      const mount = container ? await pick(o.mount, 'Mount path in the container (a folder its user can write, below its home folder): ') : undefined;
      entry = newAccount(ctx, { name: n, agent, container, label: o.label, dir: o.dir, mount });
      change = addChange(ctx, entry);
    } else {
      if (!need()) return 2;
      gone = findAccount(ctx, name);
      change = sub === 'use' ? useChange(ctx, name) : removeChange(ctx, name, !!gone.token);
    }
    const plan = preview([change]);
    if (!plan.length) { out.write('nothing to change\n'); return 0; }
    const select = await choose(plan, o, ask, out);
    if (!select.length) { if (o.yes || o.all) plan.forEach((c) => show(c, out)); return 1; }
    const code = report(apply(plan, ctx, { scope: 'global', select }), out);
    if (code) return code;
    if (sub === 'remove') {
      if (gone.token) { store(ctx).delete(gone.name); out.write('deleted the stored token\n'); }
      out.write(gone.mode === 'host' ? `the sign-in in ${gone.dir} is left: delete that folder to remove it\n` : `the volume ${gone.volume} is left: podman volume rm ${gone.volume} removes it\n`);
    }
    if (sub === 'add') {
      if (entry.mode === 'container') out.write(`A mount applies when a container is created: start the project's dev container with benchkeeper accounts login ${entry.name} --project <dir>, which mounts every container account's volume (an existing container is recreated by the command it prints).\n`);
      if (!o.yes && (await ask(`Sign in ${entry.name} now?`))) return signIn(ctx, entry, { o, out, ask });
      out.write(`Next: benchkeeper accounts login ${entry.name}\n`);
    }
    return 0;
  } catch (e) {
    out.write(`${e.message}\n`);
    return 1;
  }
}

// Installs or removes the usage script, the status line and the hook of an account (Claude Code).
async function trackAccount(ctx, a, { o, out, ask }) {
  const remove = !!o.off;
  const done = () => out.write(remove ? 'removed; the readings already kept stay in the folder\n' : 'tracking starts with the next Claude Code session of this account; usage shows after its first response. A status line in a project\'s settings takes precedence over this one, and then no reading is kept\n');
  if (a.mode === 'host') {
    const plan = preview(trackChanges(a, { remove }));
    if (!plan.length) { out.write('nothing to change\n'); return 0; }
    const select = await choose(plan, o, ask, out);
    if (!select.length) { if (o.yes || o.all) plan.forEach((c) => show(c, out)); return 1; }
    // The folder may lie outside the home folder: it is the one extra root of this change, and it is for this user alone.
    if (!remove) mkdirSync(a.dir, { recursive: true, mode: 0o700 });
    const code = report(apply(plan, { ...ctx, roots: [...ctx.roots, a.dir] }, { scope: 'global', select }), out);
    if (!code) done();
    return code;
  }
  const dir = resolve(o.project ?? '.');
  const t = trackContainer(ctx, a, dir, { remove });
  if (!t.files.length) { out.write('nothing to change\n'); return 0; }
  for (const f of t.files) out.write(`${(isSettingsFile(f.path) ? redact(f.diff) : f.diff).split('\n').map((l) => `  ${l}`).join('\n')}\n`);
  if (!o.yes && !(await ask(`Write ${t.files.length === 1 ? 'this file' : 'these files'} in the volume of ${a.name}? (no undo run: accounts track ${a.name} --off reverses it)`))) return 1;
  writeContainer(ctx, a, dir, t);
  done();
  return 0;
}

async function runAccountCommand({ o, positionals, out, ctx, ask }) {
  const args = positionals.slice(1);
  if (!AGENTS.includes(args[0])) { out.write(`run needs the agent after --: ${AGENTS.join(' or ')}\n`); return 2; }
  try {
    const problem = accountsProblem(ctx);
    if (problem) { out.write(`${problem}\n`); return 2; }
    const a = pickAccount(ctx, { name: o.account, agent: args[0] });
    // An account named with --account is never replaced by auto-pick.
    const opts = { dir: resolve(o.project ?? '.'), useToken: !!o.token, say: (l) => out.write(`${l}\n`), pick: !o.account };
    try { return runAs(ctx, a, args, { ...opts, confirmed: !!o.yes }); } catch (e) {
      if (!(e instanceof NeedsConfirm)) throw e;
      out.write(`${e.message}\n`);
      if (!(await ask('Start anyway?'))) { out.write('not started\n'); return 1; }
      // The agent reads the terminal next: this reader must not keep it.
      ask.close();
      return runAs(ctx, a, args, { ...opts, confirmed: true });
    }
  } catch (e) {
    out.write(`${e.message}\n`);
    return 1;
  }
}
