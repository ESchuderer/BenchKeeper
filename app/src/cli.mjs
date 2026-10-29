// Command line: every UI action is also a command here.
import { createInterface } from 'node:readline/promises';
import { homedir } from 'node:os';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { AGENTS, NeedsConfirm, ROTATE_WARNING, accountDoc, accountStatus, accountsProblem, addChange, commit, findAccount, handover, limitsChange, listAccounts, login, loginVars, newAccount, pickAccount, registrySettings, removeChange, rotationFor, runAs, settingsChange, store, tokenChange, trackChanges, trackContainer, useChange, writeContainer, writeHandover } from './accounts.mjs';
import { ROTATE, WINDOWS, limitsFor, settingsOf } from './usage.mjs';
import { agent, detect, unavailable } from './agents.mjs';
import { appVersion, contentDir, contentRefusal, contentVersion } from './content.mjs';
import { PROFILES, baselineIssues } from './baseline.mjs';
import { GROUPS, audit, auditMarkdown } from './audit.mjs';
import { apply, context, legacyBackups, preview, restoreLegacy, undo } from './runner.mjs';
import { addCase } from './cases.mjs';
import { childEnv } from './childenv.mjs';
import { doctor } from './doctor.mjs';
import { evalPlan, runEval } from './eval.mjs';
import { harnessTest } from './harness.mjs';
import { launch, openBrowser, startServer } from './server.mjs';
import { isDir, listFiles, readText, writeAtomic } from './fsx.mjs';
import { mask } from './redact.mjs';
import { cloneMissing } from './bootstrap.mjs';
import { projectOrigins } from './origin.mjs';
import { exportProfile, importChoices, importPlan, installedPacks, readProfile } from './profile.mjs';
import { sourceRows } from './frameworks.mjs';
import { exportPack, importPack, invalidPacks, libraryWith, packScope, packScopes, removePack, savePack, scopeText, warnings } from './packs.mjs';
import { MAX_PROJECTS, addProject, canon, confirmGit, gitCodeConfig, listProjects, packsInUse, projectsUsing, pushTargets, registeredEntry, registryProblem, relocateProject, removeProject, removeSetup, renameProject, scan, scopePlan, setupRemoval, status, unconfirmedGit, unshare, updateAll } from './projects.mjs';
import { extensionLines, extensionsView } from './extensions.mjs';
import { BUDGET_TOKENS, RULE_AGENTS, ruleChanges, ruleText, rulesChecks, rulesView } from './rules.mjs';
import { recordSession } from './session.mjs';
import { bundleEdits, describeKey, isSettingsFile, listSettings, parseInput, redact, settingsAgents, settingsChanges } from './settings.mjs';
import { byRun, clearSessionCache, keepSessionsFor, scanSessions, sessionCache } from './sessions.mjs';
import { catalog, evalResults, overview, runReport } from './reads.mjs';
import { inventory } from './inventory.mjs';
import { dashboard } from './dashboard.mjs';
import { ADVISERS, adviseSetup } from './advise.mjs';
import { collectInsights } from './insights.mjs';
import { shownFindings } from './triage.mjs';
import { narrativeInput, narrativeKey, narrativePrompt, readNarrative, runNarrative } from './narrative.mjs';
import { writeBoard } from './board.mjs';
import { detectLevel, levelFor } from './level.mjs';
import { resolvePins } from './params.mjs';
import { PLUGINS, LEVELS, globalPlan, installedPlugins, installedRefusal, skillsSpec, skillsVerify } from './steps/global.mjs';
import { npxEnv, projectCtx, projectPlan, scopeCtx, tryState } from './steps/project.mjs';
import { focusOn, globalUntracked, projectSkills, skillAction } from './skills.mjs';
import { clearKnowledge, entryLine, knowledgeDir, linkedParent, readKnowledge } from './knowledge.mjs';
import { automationDiff, automationStatus, installChanges, load as loadAutomations, readRegistry, removeChanges, updateChanges } from './automations.mjs';
import { precheck } from './precheck.mjs';
import { undoableAutomation } from './orca/index.mjs';
import { ENTRY, TIMEOUT, UsageError, logFile, removeWebhook, sendWebhook, setWebhook, webhookStatus } from './webhook.mjs';

export const HELP = `benchkeeper ${appVersion}: installs, updates and undoes the BenchKeeper agent setup.

Usage: benchkeeper <command> [options]

  ui [--no-open] [--port N]         local web UI (default command)
  plan [--agents a,b] [--pack p] [--level l]
                                    global setup: the changes, with a diff each, nothing written
  apply [--agents a,b] [--pack p] [--level l] [--yes] [--all]
                                    global setup: asks per change; --yes takes the default selection,
                                    --all also the removals, except a plugin BenchKeeper did not install
                                    (removed only by its own answer). --level lite|standard: the BenchKeeper plugin
                                    alone, nothing else on the machine (standard: then projects apply writes
                                    the local block per repository); full: rules, settings, plugins, tools.
                                    Default: the level found (doctor shows it), full on a machine without BenchKeeper
  profile export [file] [--agents a,b] [--origins]
                                    agents, packs, own packs and registered projects with their answers as one file;
                                    --origins adds each project's origin address (listed first; a login in it is dropped)
  profile import <file> [--yes] [--clone-into dir]
                                    shows the global and project changes, applies the chosen ones; a missing project with an
                                    origin is cloned into dir after its own question (never under --yes); other missing paths are skipped
  doctor [dir] [--project dir] [--agents a,b] [--baseline auto|oss|private-advisory] [--baseline-ref ref]
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
  rules show <file> [--agent a] [--project dir]
                                    the text of one file rules list shows (the first 200000 characters)
  rules check [--agent a] [--project dir] [--limit tokens]
                                    checks the files rules list shows: over the size limit of one file (default 10000
                                    tokens), auto memory beyond what loads, imports, links and npm scripts that do not
                                    exist, the same line in two loaded files, path-scoped rules that match no file,
                                    empty or unreadable files, rule files no agent reads; exit 1 on an error finding
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
  evals results                     the stored eval results: per target and agent the miss and false trigger rates
  verify [dir] [--project dir] [--agents a,b]
                                    deterministic checks: files match the ledger, expected plugins and skills,
                                    nothing unexpected installed, project skills present; exit 1 on a failure
  history                           runs, newest first
  history show <run>                one run: each change with its status and the diff of each file it wrote (settings
                                    values masked; a recorded session's files between its snapshots, the first 50)
  undo <run> [--step <step>] [--unit <unit>]
                                    restores the files of a run or one of its steps or units
  restore <name>                    restores a setup.sh backup (~/.config/benchkeeper/backup/<name>)
  projects plan|apply [dir] [--project dir] [--agents a,b] [--env e] [--sandbox] [--guards|--no-guards] [--pack p] [--skill s] [--tier t] [--yes]
                    [--agent-file path]
                    [--share|--local] [--caller lint-js|lint-python|sonar]
                                    project setup in dir (--project names it too; both must name the same folder); answers default to the project's .benchkeeper/state.json;
                                    local (the default): CLAUDE.local.md, AGENTS.override.md and skills that git
                                    ignores (.git/info/exclude); --share commits them (AGENTS.md block, CLAUDE.md);
                                    --caller writes that repo-baseline workflow file (never GitHub settings);
                                    --agent-file picks agent files of a source (skills sources lists them; none clears)
  packs [list|show <id>|save <id> --skill s..|export <id>|import <file> [--id i]|remove <id>]
                                    library packs and own packs (own ones in packs/ of the config folder); show: one
                                    pack with the registered projects that use it; remove refuses a pack a registered
                                    project still names
  packs warnings <id>               the pairs of the pack's skills whose descriptions overlap, so an agent may load the wrong one
  packs scope <id> [global|projects] [--yes]
                                    a pack's install scope: global (once on the machine, for every project) or projects
                                    (in each project that selects it; Claude Code plugins at local scope). Without a
                                    scope: the current one and the scopes each agent offers. With one: a plan that
                                    moves the installs, with a diff (undo restores it)
  packs enable|disable <id>.. [--project dir | --global] [--yes]
                                    switches packs on top of the current state, as a plan with a diff (undo restores it):
                                    a project's packs (default: the current folder), or the plugins of a pack that
                                    installs one (--global). Disabling removes the skills no other pack or single pick needs
  skills [list|update|reset|remove|adopt|add|enable|disable] [name..] [--project dir] [--yes]
                                    skills of a project: state (current, outdated, modified, removed, disabled), the commit
                                    installed and the one the library offers, and folders no setup installed (untracked,
                                    never touched). update: to the library's copy (no name: every outdated one); reset: a
                                    skill edited here goes back to the library's (the edit is backed up, the diff shown);
                                    remove: a single pick leaves the project; adopt: an untracked library skill becomes a pick;
                                    add: a library skill the project lacks becomes a pick (names required);
                                    disable moves a skill to .benchkeeper/disabled/, enable moves it back (names required)
  skills list --library             the library's skills with the number of registered projects that have each
  skills show <name>                the SKILL.md of a library skill BenchKeeper ships; any other names its source
  skills sources [list]             agent-file sources a project picks files from (--agent-file), with the evidence
  skills cli                        checks the registry signatures of the skills CLI release a skill install runs and
                                    prints the environment and npx command to start every skills CLI command with
  projects status [dir]             app version, install level, agents with the BenchKeeper plugin, and the setup state of
                                    each registered project (dir: that folder only): setup version, origin, checkout,
                                    branch, clean, the pending changes; nothing is written
  projects advise [dir] [--agent claude|codex]
                                    the env, packs and skills an agent suggests for a registered project, each with a
                                    reason: one session on your login (default: the first installed of claude, codex) that
                                    reads the project and writes nothing; refused in CI
  projects [list|add <dir>..|scan <root>|remove <dir>..]
                                    projects Update all covers (projects.json in the config folder); add refuses another worktree
                                    of a registered repository unless --worktree; remove only unregisters
  projects audit [dir] [--only workflows,tests,code,findings] [--json]
                                    where the project's CI and tests are bloated or in bad shape, from files only: workflow
                                    triggers, cancel, cache, repeated builds, matrix size, pins, permissions, a coverage floor
                                    far below the measured value, duplicated code and tests, large files, a lint step that
                                    cannot fail; a check whose need is missing (a report, a floor) is listed as skipped with
                                    how to enable it; Markdown, nothing is run or written
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
  projects confirm-git <dir>..      shows the project's git config that runs code or sends git elsewhere (hooks, ssh
                                    command, credential helper, push URL, URL rewrites and the like) and, after a yes
                                    typed in a terminal, records it as confirmed for projects update --unattended (key
                                    and a hash of each value)
  projects update [dir..] [--yes] [--no-push] [--dry-run] [--unattended] [--max N] [--baseline auto|oss|private-advisory]
                                    dir..: only these registered projects (default: all); per project: local setup (the
                                    default) applied in the checkout; shared setup
                                    (projects apply --share) on branch chore/agent-setup-<version> in a worktree,
                                    one commit, push and pull request when origin is on GitHub;
                                    --dry-run stops after the plan; pushes go to at most 25 repositories per run (--max N);
                                    --baseline also reports each project's GitHub settings drift, changing none
                                    --unattended skips a project whose git config that runs code differs from the
                                    one confirmed with projects confirm-git
  sessions board [--no-open]        sessions board of the Claude Code and Codex transcripts on this machine:
                                    tier, setup, skills, tests, cost, pull requests (~/.config/benchkeeper/board.html);
                                    Ponytail's ledger, when present, is read beside them (read only)
  sessions list [--run id]          orchestrated runs with cost (Claude Code, API-equivalent USD) and tokens (Codex: tokens
                                    only) from the sessions scan; --run: that run per task
  sessions cache show|clear|set [--keep-days N|none] [--yes]
                                    the summaries the scan keeps after an agent deletes a transcript: show counts them with
                                    the retention; set --keep-days (1 to 3650, none: for good) changes it, the next scan
                                    drops older ones; clear removes them all, the history of deleted transcripts for good
                                    (run it while no scan runs in the web UI: that scan writes them back). Both ask first
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
                  [--pool name|none] [--auto-pick on|off] [--when-none stop|wait] [--continue-below on|off]
                  [--rotate-claude off|handover] [--rotate-codex off|handover] [--reset]
                                    the minimum headroom (percent, defaults 8 and 3) below which run asks first, and the notice
                                    level before it (default twice the minimum); with a name, that account's own values and
                                    --pool (accounts of one person that auto-pick may choose among). Without a name:
                                    the defaults, --auto-pick (off by default: a new run under the default account starts under
                                    a pool member with headroom; the provider's terms on rotating accounts are unclear, so you
                                    carry that call), --when-none (no member has headroom: stop, or wait for the earliest
                                    reset), --continue-below (run starts below the minimum without asking) and --rotate-<agent>
                                    (off by default, or handover: see accounts handover). No flag shows them
  accounts handover <name> [--project dir] [--yes]
                                    opt-in rotation (accounts limits --rotate-<agent> handover): when the account is below its
                                    minimum and another account of its pool is at or above it, shows both accounts and a
                                    handover (task, done, open, worktree and branch, uncommitted file names, next step; from
                                    git and .benchkeeper/handoff.md, no transcript text, no credential), asks (--yes or
                                    --continue-below on: no question), writes .benchkeeper/handover.md and starts the agent as
                                    the other account with it as the first prompt. run does the same after the agent exits, in
                                    a terminal. No login or credential moves between accounts
  accounts login <name> [--token] [--email address] [--no-browser] [--project dir]
                                    guided sign-in: opens the sign-in link in a private browser window (Firefox, Chrome,
                                    Chromium, Edge), else prints it with the code; paste the code the browser shows if it
                                    asks. --token: Claude Code setup-token kept in the OS credential store; Codex: the
                                    access token piped on stdin goes to codex login --with-access-token
  run [--account name] [--project dir] [--token] [--yes] -- claude|codex [args]
                                    runs the agent as an account (default: the agent's default account) after a sign-in
                                    check and, below the minimum headroom, a question (--yes answers it); environment: the filtered one plus the account's folder variable (--token: the
                                    kept token, Claude Code only). Dev container accounts run through devcontainer exec
  insights --json [--project dir] [--agents a,b] [--narrative --agent claude|codex [--yes]]
                                    findings with id, severity, evidence and a fix: installed skills no session used,
                                    doctor findings, versions behind; the session signal needs 20 sessions
                                    of the last 90 days and reports nothing below that; nothing is written, except with --narrative --yes: the
                                    findings go to the agent in one session and its answer is cached on this machine
  knowledge show [dir]              what the maintaining-repos skill stored for the project (.benchkeeper/knowledge/,
                                    ignored by git): entries per file; a file that does not parse is listed as ignored
  knowledge clear [dir] [--yes]
                                    removes that folder after a question and nothing else of the project
  inventory [--agents a,b]          the global setup items with their state, as the Dashboard counts them
  dashboard [--agents a,b]          the machine's and each registered project's item states, packs per agent, catalog
  automations [list]                the automation templates (generic ones and your own in automations/ of the config
                                    folder) and which are installed
  automations show <id>             one template: its fields, parameters and prompt
  automations install <id> [--param name=value..] [--project dir] [--yes]
                                    creates the automation on the runner, disabled, and records it
                                    in automations.json of the config folder; a plan, undo removes it again
  automations update <id> [--yes]   shows the diff, then sets the runner's automation to the template again
  automations remove <id> [--yes]   removes it from the runner with its run history and from the record; undo restores
                                    the record only, install creates it again
  automations diff <id>             the installed automation as the runner holds it against the template now
  automations status                each installed one: current, outdated (template changed), modified (changed on
                                    the runner), removed (gone from the runner) or unknown; nothing is written
  automations precheck <id> [--param name=value..] [--project dir]
                                    the built-in read-only check of issue-pickup or pr-watcher that a template's
                                    precheck calls: exit 0 and one line per item when there is work, 1 when there is
                                    none, 2 without the policy file on the default branch, the runner or gh
  webhook set|remove|status         the webhook a run calls when it finishes or needs a person, off until set: set reads
                                    the URL (https, or http to this machine) from the first line of stdin and an optional
                                    bearer token from the second into the OS credential store; remove [--yes] deletes it;
                                    status shows whether one is set and the last failed send, never the URL or token
  webhook send --state finished|failed|needs-person [--run id] [--automation id] [--task id]
                                    one POST of these ids and the state, started detached with a 5 second limit and no
                                    retry; without a webhook nothing happens; a failure is one line in
                                    ~/.cache/benchkeeper/webhook.log, without the URL
  pins list [dir]                   each phase (research, implement, review, verify) with the agent, model and effort
                                    to use and the file it came from (.benchkeeper/pins.json, then pins.local.json,
                                    then the session's own agent); an invalid file is refused with its rules, exit 1

--json (doctor, verify, plan, projects plan, history and history show, projects list, status, scan, audit and advise, packs list,
        show and warnings, skills list, show and sources, rules list, show and check, extensions list, settings list and get,
        sessions board, list and cache, insights, profile export, knowledge show, accounts list and status,
        evals plan, run and results, inventory, dashboard; apply, projects apply, add, remove, rename, relocate and
        update, settings set, rules and packs enable|disable, skills update, undo)
                                    one JSON document on stdout, logs on stderr; exit 0 clean, 1 findings of
                                    level error, 2 usage or read failure; keys in app/README.md. A changing command
                                    that would ask needs --yes: without it exit 2 and nothing changes

Agents: claude, codex, gemini, copilot (default: the installed ones). Packs: see plugins/benchkeeper/library/README.md.
Env (where the agent runs): container (default; host-agent or host when AGENTS.md says the agent runs on the host), host-agent, sandbox, host. Tier: quick, standard, full, research.`;

const OPTIONS = {
  agents: { type: 'string' }, pack: { type: 'string', multiple: true }, yes: { type: 'boolean' }, all: { type: 'boolean' },
  step: { type: 'string' }, unit: { type: 'string' }, 'no-open': { type: 'boolean' }, port: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  env: { type: 'string' }, sandbox: { type: 'boolean' }, guards: { type: 'boolean' }, 'no-guards': { type: 'boolean' }, share: { type: 'boolean' }, local: { type: 'boolean' }, skill: { type: 'string', multiple: true }, 'agent-file': { type: 'string', multiple: true }, tier: { type: 'string' }, project: { type: 'string' },
  'no-push': { type: 'boolean' }, narrative: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, unattended: { type: 'boolean' }, max: { type: 'string' }, id: { type: 'string' },
  level: { type: 'string' }, target: { type: 'string', multiple: true }, model: { type: 'string' }, expected: { type: 'string' }, 'should-not': { type: 'boolean' }, transcript: { type: 'string' },
  description: { type: 'string' }, query: { type: 'string' }, run: { type: 'string' }, scope: { type: 'string' },
  baseline: { type: 'string' }, 'baseline-ref': { type: 'string' }, caller: { type: 'string', multiple: true },
  only: { type: 'string' }, json: { type: 'boolean' }, check: { type: 'boolean' }, agent: { type: 'string' }, layer: { type: 'string' }, advanced: { type: 'boolean' }, unset: { type: 'boolean' }, bundle: { type: 'string' },
  setup: { type: 'boolean' }, worktree: { type: 'boolean' }, notes: { type: 'string' }, global: { type: 'boolean' },
  origins: { type: 'boolean' }, 'clone-into': { type: 'string' },
  'five-hour': { type: 'string' }, 'seven-day': { type: 'string' }, 'warn-five-hour': { type: 'string' }, 'warn-seven-day': { type: 'string' }, pool: { type: 'string' }, 'auto-pick': { type: 'string' }, 'when-none': { type: 'string' }, 'continue-below': { type: 'string' }, 'rotate-claude': { type: 'string' }, 'rotate-codex': { type: 'string' }, off: { type: 'boolean' }, reset: { type: 'boolean' },
  param: { type: 'string', multiple: true }, state: { type: 'string' }, task: { type: 'string' }, automation: { type: 'string' },
  limit: { type: 'string' }, account: { type: 'string' }, library: { type: 'boolean' }, 'keep-days': { type: 'string' }, container: { type: 'boolean' }, label: { type: 'string' }, dir: { type: 'string' }, mount: { type: 'string' }, email: { type: 'string' }, token: { type: 'boolean' }, 'no-browser': { type: 'boolean' },
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
  // A new reader of the same input, for a question after the agent had the terminal.
  ask.fresh = () => asker(input, out);
  return ask;
}

async function choose(plan, o, ask, out) {
  // A plugin BenchKeeper did not install is removed only by its own answer, never by --yes or --all.
  if (o.yes) return plan.filter((c) => !c.error && !c.foreign && (o.all || c.selected)).map((c) => c.id);
  // --all alone is not a go-ahead: removals are on the list, so the question names them first.
  if (o.all) {
    const all = plan.filter((c) => !c.error && !c.foreign), removals = all.filter((c) => c.destructive);
    removals.forEach((c) => show(c, out));
    return (await ask(`Apply ${all.length} changes${removals.length ? `, ${removals.length} of them removals (listed above)` : ''}?`)) ? all.map((c) => c.id) : [];
  }
  const select = [], units = new Map();
  for (const c of plan) {
    show(c, out);
    // One answer per unit: its changes go together.
    if (c.unit && units.has(c.unit)) { if (units.get(c.unit)) select.push(c.id); continue; }
    const yes = !c.error && (await ask(c.foreign ? 'remove it?' : c.unit ? 'apply (with the changes that go with it)?' : 'apply?'));
    if (c.unit) units.set(c.unit, yes);
    if (yes) select.push(c.id);
  }
  return select;
}

// The origin addresses an export would write, listed before it writes them (to stderr when the profile itself goes to stdout).
function shownOrigins(ctx, to) {
  const found = projectOrigins(ctx, listProjects(ctx).map((x) => x.path));
  for (const f of found) to.write(f.url ? `origin ${f.path}: ${f.url}\n` : `no origin written for ${f.path}: ${f.reason}\n`);
  return found;
}

function report(run, out) {
  out.runs?.push(run);
  for (const e of run.entries) out.write(`${e.status.padEnd(7)} ${e.title}${e.error || e.reason ? `: ${e.error ?? e.reason}` : ''}\n`);
  if (run.kind !== 'undo') out.write(`run ${run.id}: undo with benchkeeper undo ${run.id}\n`);
  return run.status === 'done' ? 0 : 1;
}

export function machineContext(env = process.env) {
  const home = env.BENCHKEEPER_HOME || homedir();
  const ctx = context({ home, appVersion, refuse: () => contentRefusal(contentDir) ?? installedRefusal(ctx), undoable: undoableAutomation });
  return ctx;
}

function selectedAgents(ctx, list) {
  if (list) return list.split(',').map((s) => s.trim()).filter(Boolean);
  return detect(ctx).filter((a) => a.installed).map((a) => a.id);
}

function show(c, out) {
  out.write(`${c.foreign ? '' : c.destructive ? 'remove ' : 'change '}${c.title}${c.error ? `\n  cannot merge: ${c.error}` : ''}\n`);
  if (c.foreign) out.write(`  add ${c.pack} to a project: benchkeeper projects apply <dir> --pack ${c.pack}\n  ${c.impact}\n`);
  if (c.kind === 'command' && !c.diff) out.write(`  $ ${c.argv.join(' ')}\n`);
  else if (c.diff) out.write(`${(isSettingsFile(c.path) ? redact(c.diff) : c.diff).split('\n').map((l) => `  ${l}`).join('\n')}\n`);
}

// A source as `skills sources` prints it, with the agent files to pick.
const rowText = (f) => `${f.id.padEnd(14)} ${f.kind.padEnd(7)} ${f.title} (${f.pin}): ${f.verdict} ${f.hooks}${f.limits ? ` ${f.limits}` : ''} Evaluation: ${f.evaluation} README: ${f.readme}\n${f.files.map((x) => `${''.padEnd(14)} --agent-file ${x.path}: ${x.pickWhen} Source: ${x.url}\n`).join('')}`;

export async function main(argv, { out = process.stdout, err = process.stderr, input = process.stdin, ctx = machineContext() } = {}) {
  const ask = asker(input, out);
  try { return await command(argv, { out, err, ask, ctx }); } catch (e) {
    // With --json a failure is a document too: an unknown option, an unreadable file.
    if (!argv.includes('--json')) throw e;
    err.write(`${redact(e.message)}\n`);
    const [cmd = 'ui', arg, sub] = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: false }).positionals;
    out.write(jsonDoc(commandName(cmd, arg, sub), { error: redact(e.message) }));
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
  out.projects?.push(...results);
  for (const r of results) out.write(`${r.status.padEnd(12)} ${r.path}${r.pr ? `  ${r.pr}` : ''}${r.run ? `  undo: benchkeeper undo ${r.run}` : ''}${r.reason ? `: ${r.reason}` : ''}\n`);
  return results.some((r) => r.status === 'stopped') ? 1 : 0;
}

// projects audit: the folder and the groups to check, or the message that refuses them.
function auditTarget(o, positionals) {
  if (positionals.length > 3) return { error: `unexpected argument ${positionals[3]}` };
  const dir = resolve(positionals[2] ?? '.');
  const only = o.only === undefined ? GROUPS : o.only.split(',').map((g) => g.trim());
  const bad = only.find((g) => !GROUPS.includes(g));
  if (bad !== undefined) return { error: `--only takes ${GROUPS.join(', ')}, not "${bad}"` };
  return isDir(dir) ? { dir, only } : { error: `${dir} is not a folder` };
}

// projects status: the overview and the setup state of each registered project, or of the folder named.
async function projectsStatus(ctx, positionals) {
  if (positionals.length > 3) return { error: `unexpected argument ${positionals[3]}` };
  const dir = positionals[2] && resolve(positionals[2]);
  if (dir && !isDir(dir)) return { error: `${dir} is not a folder` };
  const { projects, ...rest } = await overview(ctx, detect(ctx));
  return { ...rest, projects: (dir ? [dir] : projects.map((p) => p.path)).map((p) => status(ctx, p)) };
}

const kept = (days) => (days === null ? 'for good' : `${days} days`);
// sessions cache: the subcommand and, for set and clear, the lines that show the change and the change itself; or a usage error.
function cacheCommand(ctx, o, positionals) {
  const sub = positionals[2];
  if (!['show', 'set', 'clear'].includes(sub)) return { error: 'sessions cache needs show, set or clear' };
  if (positionals.length > 3) return { error: `unexpected argument ${positionals[3]}` };
  if (sub !== 'set' && o['keep-days'] !== undefined) return { error: '--keep-days belongs to sessions cache set' };
  if (sub === 'show') return { sub };
  const now = sessionCache(ctx);
  if (sub === 'clear') return { sub, lines: [`remove the ${now.sessions} session summaries: those of transcripts the agent already deleted are gone for good, the next scan reads the others again; the retention stays ${kept(now.keepDays)}`], change: () => clearSessionCache(ctx) };
  const v = o['keep-days'], days = v === 'none' ? null : /^\d+$/.test(v ?? '') ? Number(v) : Number.NaN;
  if (Number.isNaN(days) || (days !== null && (days < 1 || days > 3650))) return { error: 'usage: sessions cache set --keep-days N|none (N: a whole number from 1 to 3650)' };
  return { sub, lines: [`keep session summaries ${kept(days)} instead of ${kept(now.keepDays)}${days === null ? '' : `: the next scan drops those older than ${days} days`}`], change: () => keepSessionsFor(ctx, days) };
}

// rules show, skills show, packs warnings and projects advise: reads the terminal and --json print the same way.
const TEXT_READS = { rules: 'show', skills: 'show', packs: 'warnings', projects: 'advise' };
const textRead = (cmd, arg) => !!arg && TEXT_READS[cmd] === arg;
// The document of one of them, or the error with its exit code (2: usage).
async function readDoc(ctx, { cmd, o, positionals, err }) {
  const [, , target, extra] = positionals;
  if (extra !== undefined) return { error: `unexpected argument ${extra}`, code: 2 };
  if (cmd === 'rules') {
    if (!target) return { error: 'rules show needs a file, see benchkeeper rules list', code: 2 };
    if (o.agent && !RULE_AGENTS.includes(o.agent)) return { error: `agent must be one of ${RULE_AGENTS.join(', ')}`, code: 2 };
    try { return { doc: ruleText(ctx, { agent: o.agent, file: resolve(target), dir: o.project ? resolve(o.project) : undefined }) }; } catch (e) { return { error: e.message, code: 1 }; }
  }
  if (cmd === 'skills') {
    if (!target) return { error: 'skills show needs a skill name, see benchkeeper skills list --library', code: 2 };
    const skill = libraryWith(ctx).skills.find((s) => s.name === target);
    if (!skill) return { error: `unknown skill ${target}, see benchkeeper skills list --library`, code: 1 };
    // Only the skills BenchKeeper ships have their text in the app; the others live at their source.
    return { doc: { name: skill.name, source: skill.source, text: skill.source === 'own' ? readText(join(contentDir, 'library', skill.name, 'SKILL.md')) : null } };
  }
  if (cmd === 'packs') {
    if (!target) return { error: 'packs warnings needs a pack, see benchkeeper packs list', code: 2 };
    const pack = libraryWith(ctx).packs.find((p) => p.id === target);
    if (!pack) return { error: `unknown pack ${target}, see benchkeeper packs list`, code: 1 };
    return { doc: { pack: pack.id, warnings: warnings(pack.skills ?? []) } };
  }
  const dir = canon(target ?? '.');
  if (!listProjects(ctx).some((p) => p.path === dir)) return { error: `${dir} is not a registered project: benchkeeper projects add ${dir}`, code: 1 };
  const installed = selectedAgents(ctx);
  const agent = o.agent ?? ADVISERS.find((a) => installed.includes(a));
  if (!ADVISERS.includes(agent) || !installed.includes(agent)) return { error: `--agent must be an installed one of ${ADVISERS.join(', ')}`, code: 2 };
  if (process.env.CI) return { error: 'projects advise starts an agent session on a subscription and does not run in CI', code: 2 };
  err.write(`${agent} reads ${dir} in one session (up to 5 minutes)\n`);
  try { return { doc: { dir, agent, ...(await adviseSetup(ctx, { dir, agent, lib: libraryWith(ctx) })) } }; } catch (e) { return { error: e.message, code: 1 }; }
}

async function printRead(ctx, { cmd, o, positionals, out, err }) {
  const r = await readDoc(ctx, { cmd, o, positionals, err });
  if (r.error) { out.write(`${r.error}\n`); return r.code; }
  const d = r.doc;
  if (cmd === 'rules') {
    out.write(d.text && !d.text.endsWith('\n') ? `${d.text}\n` : d.text);
    if (d.truncated) err.write(`${d.path} is longer: the first 200000 characters are shown\n`);
  } else if (cmd === 'skills') out.write(d.text ?? `${d.name} comes from ${d.source}: its text is not in the app\n`);
  else if (cmd === 'packs') out.write(d.warnings.length ? d.warnings.map((w) => `${w}\n`).join('') : `no overlapping skill descriptions in ${d.pack}\n`);
  else {
    if (d.env) out.write(`env    ${d.env.id}: ${d.env.reason}\n`);
    for (const p of d.packs) out.write(`pack   ${p.id}: ${p.reason}\n`);
    for (const s of d.skills) out.write(`skill  ${s.name}: ${s.reason}\n`);
    if (!d.env && !d.packs.length && !d.skills.length) out.write(`${d.agent} suggested nothing for ${d.dir}\n`);
  }
  return 0;
}

const pct = (x) => (x == null ? '-' : `${Math.round(x * 100)}%`);
const resultLine = (r) => `${r.target}  ${r.agent} ${r.agentVersion}${r.model ? ` ${r.model}` : ''}  miss ${pct(r.missRate)}  false trigger ${pct(r.falseTriggerRate)}`;
const indent = (d) => (d ? `${d.trimEnd().split('\n').map((l) => `    ${l}`).join('\n')}\n` : '');

const PLAN_FLAGS = 'agents env sandbox guards no-guards share local pack skill tier agent-file caller';
// The flags each command reads besides --help and --json; a command without an entry is refused as unknown later.
const FLAGS = {
  ui: 'no-open port', plan: 'agents pack level', apply: 'agents pack level yes all',
  'profile export': 'agents origins', 'profile import': 'yes all clone-into',
  doctor: 'agents baseline baseline-ref project', verify: 'agents project',
  'settings list': 'agent advanced project', 'settings get': 'agent project', 'settings set': 'agent layer project unset bundle yes all',
  'rules list': 'agent agents project', 'rules show': 'agent project', 'rules check': 'agent agents project limit',
  'rules disable': 'agent project yes all', 'rules enable': 'agent project yes all', 'extensions list': 'agent project',
  'evals cases': 'target expected should-not run project scope transcript description query',
  'evals plan': 'agents model target all', 'evals run': 'agents model target all yes', 'evals results': '',
  history: '', 'history show': '', undo: 'step unit', restore: 'yes',
  'projects plan': `${PLAN_FLAGS} project`, 'projects apply': `${PLAN_FLAGS} project yes all`,
  'packs list': '', 'packs show': '', 'packs save': 'skill', 'packs export': '', 'packs import': 'id', 'packs remove': '', 'packs warnings': '',
  'packs scope': 'agents yes all', 'packs enable': `${PLAN_FLAGS} project global yes all`, 'packs disable': `${PLAN_FLAGS} project global yes all`,
  'skills list': 'project check agents library', 'skills show': '', 'skills sources': '', 'skills cli': '',
  ...Object.fromEntries(['update', 'reset', 'remove', 'adopt', 'add', 'enable', 'disable'].map((s) => [`skills ${s}`, `${PLAN_FLAGS} project check yes all`])),
  'projects status': '', 'projects advise': 'agent', 'projects list': '', 'projects add': 'worktree', 'projects scan': '',
  'projects remove': 'setup yes no-push', 'projects audit': 'only', 'projects rename': 'notes', 'projects relocate': '',
  'projects unshare': 'yes no-push max', 'projects confirm-git': '', 'projects update': 'yes no-push dry-run unattended max baseline baseline-ref',
  'sessions board': 'no-open', 'sessions list': 'run', 'sessions cache': 'keep-days yes', 'sessions record': 'project',
  'accounts list': '', 'accounts add': 'agent container mount label dir token email no-browser project yes all', 'accounts use': 'yes all',
  'accounts remove': 'yes all', 'accounts status': 'project', 'accounts track': 'off project yes all', 'accounts handover': 'project yes',
  'accounts limits': 'five-hour seven-day warn-five-hour warn-seven-day pool auto-pick when-none continue-below rotate-claude rotate-codex reset yes all',
  'accounts login': 'token email no-browser project', run: 'account project token yes',
  insights: 'project agents narrative agent yes', 'knowledge show': '', 'knowledge clear': 'yes', inventory: 'agents', dashboard: 'agents',
  'automations list': '', 'automations show': '', 'automations install': 'param project yes all', 'automations update': 'yes all',
  'automations remove': 'yes all', 'automations diff': '', 'automations status': '', 'automations precheck': 'param project',
  'webhook set': '', 'webhook remove': 'yes', 'webhook status': '', 'webhook send': 'state run automation task', 'pins list': '',
};
// The most positionals of the commands that take a fixed number and do not check it themselves.
const ARGS = { ui: 1, plan: 1, apply: 1, doctor: 2, verify: 2, history: 1, undo: 2, restore: 2, 'projects plan': 3, 'projects apply': 3, 'skills cli': 2, 'pins list': 3 };
// The position of the folder that --project names as well.
const FOLDER = { doctor: 1, verify: 1, 'projects plan': 2, 'projects apply': 2 };

// The usage error of a flag or argument the command does not read, if any; puts a --project folder in its positional.
function checkArgs(o, positionals) {
  const [cmd = 'ui', arg] = positionals;
  const name = [`${cmd} ${arg ?? 'list'}`, cmd].find((k) => Object.hasOwn(FLAGS, k));
  if (!name) return undefined;
  const flag = Object.keys(o).find((f) => !['help', 'json', ...FLAGS[name].split(' ')].includes(f));
  if (flag) return `--${flag} does not belong to ${name}`;
  const at = FOLDER[name];
  if (at && o.project !== undefined) {
    if (positionals[at] !== undefined && resolve(positionals[at]) !== resolve(o.project)) return `--project ${o.project} and ${positionals[at]} name different folders: give one`;
    positionals[at] = o.project;
  }
  return positionals.length > (ARGS[name] ?? Infinity) ? `unexpected argument ${positionals[ARGS[name]]}` : undefined;
}

async function command(argv, { out, err, ask, ctx }) {
  const { values: o, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  if (o.help || positionals[0] === 'help') { out.write(`${HELP}\n`); return 0; }
  const refused = checkArgs(o, positionals);
  // With --json, main turns the error into the document.
  if (refused) { if (o.json) throw new Error(refused); out.write(`${refused}\n`); return 2; }
  const [cmd = 'ui', arg] = positionals;
  if (o.json && changing(cmd, arg)) return changeJson(argv, { cmd, arg, out, err, ctx });
  if (o.json && cmd !== 'verify') return jsonCommand({ cmd, arg, o, positionals, out, err, ctx });
  if (cmd === 'ui') {
    if (o.port !== undefined && !(/^\d+$/.test(o.port) && Number(o.port) <= 65535)) { out.write('--port must be a whole number from 0 to 65535\n'); return 2; }
    const port = Number(o.port ?? 0);
    let started;
    try { started = await startServer(ctx, { port }); } catch (e) {
      out.write(e.code === 'EADDRINUSE' ? `port ${port} is in use: stop the other server or pick another port\n` : `port ${port}: ${e.code ?? e.message}\n`);
      return 1;
    }
    const { server, url } = started;
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
    for (const id of agents) for (const m of unavailable(id)) out.write(`${m}\n`);
    const plan = preview(globalPlan({ ctx, agents, options: { packs: o.pack ?? [], packsInUse: packsInUse(ctx), level } }));
    if (!plan.length) { out.write(`nothing to change for ${agents.join(', ')}\n`); return 0; }
    if (cmd === 'plan') {
      plan.forEach((c) => show(c, out));
      out.write(`${plan.length} changes. Apply: benchkeeper apply${o.agents ? ` --agents ${o.agents}` : ''}\n`);
      return 0;
    }
    return report(apply(plan, ctx, { scope: 'global', select: await choose(plan, o, ask, out) }), out);
  }
  if (textRead(cmd, arg)) return printRead(ctx, { cmd, o, positionals, out, err });
  if (cmd === 'packs' && ['enable', 'disable'].includes(arg)) return switchPacks(ctx, { o, positionals, out, ask });
  if (cmd === 'packs' && arg === 'scope') return packScopeCommand(ctx, { o, positionals, out, ask });
  if (cmd === 'skills' && o.library && [undefined, 'list'].includes(arg)) {
    for (const s of catalog(ctx).skills) out.write(`${s.name.padEnd(30)} ${String(s.projects).padStart(3)} project${s.projects === 1 ? ' ' : 's'}  ${s.source}\n`);
    return 0;
  }
  if (cmd === 'skills' && arg === 'sources' && [undefined, 'list'].includes(positionals[2])) { out.write(sourceRows().map(rowText).join('')); return 0; }
  if (cmd === 'skills' && arg === 'cli') {
    // The same release, environment and signature check as a skill install of the app.
    const env = npxEnv();
    const r = ctx.run(skillsVerify(ctx), { cwd: ctx.home, env: childEnv(env) });
    if (r.code !== 0) { out.write(`${r.stderr ?? ''}${skillsSpec(ctx)} failed the signature check\n`); return 1; }
    out.write(`${Object.entries(env).map(([k, v]) => `${k}=${v}`).join(' ')} npx -y ${skillsSpec(ctx)}\n`);
    return 0;
  }
  if (cmd === 'skills') return skillsCommand(ctx, { o, positionals, out, ask });
  if (cmd === 'packs') {
    if (arg === 'save') out.write(`saved ${savePack(ctx, { id: positionals[2], skills: o.skill ?? [] }).id}\n`);
    else if (arg === 'export') out.write(exportPack(ctx, positionals[2]));
    else if (arg === 'import') out.write(`imported ${importPack(ctx, readFileSync(positionals[2], 'utf8'), o.id).id}\n`);
    else if (arg === 'show') {
      const p = catalog(ctx).packs.find((x) => x.id === positionals[2]);
      if (!p) { out.write(`unknown pack ${positionals[2] ?? ''}, see benchkeeper packs list\n`); return positionals[2] ? 1 : 2; }
      out.write(`${p.id}  ${p.own ? 'own' : 'library'}  ${p.title ?? p.id}\n${p.skills ? `skills: ${p.skills.join(', ')}` : `plugin: ${Object.values(p.plugins ?? {}).map((x) => x.id).join(', ')}`}\nused by: ${p.usedBy.join(', ') || 'no registered project'}\n`);
    }
    else if (arg === 'remove') { removePack(ctx, positionals[2], { usedBy: projectsUsing(ctx, positionals[2]) }); out.write(`removed ${positionals[2]}\n`); }
    else if (arg && arg !== 'list') { out.write(`unknown packs command ${arg}\n`); return 2; }
    else {
      for (const p of libraryWith(ctx).packs) out.write(`${p.id.padEnd(16)} ${p.own ? 'own    ' : 'library'} ${packScope(ctx, p).padEnd(8)} ${p.skills?.join(', ') ?? `plugin: ${Object.values(p.plugins ?? {}).map((x) => x.id).join(', ')}`}\n`);
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
    for (const p of prompts) out.write(`  ${p.command}   (${p.why})\n`);
    return 0;
  }
  if (cmd === 'projects' && arg === 'status') {
    const r = await projectsStatus(ctx, positionals);
    if (r.error) { out.write(`${r.error}\n`); return 2; }
    out.write(`benchkeeper ${r.version}, level ${r.level.level ?? 'none'}\n`);
    for (const a of r.agents) out.write(`${a.id.padEnd(8)} ${a.installed ? a.version : 'not installed'}${a.plugin ? `  plugin ${a.plugin.installed ?? 'not installed'} (this app sets up ${a.plugin.available})` : ''}\n`);
    for (const p of r.projects) {
      const where = p.missing ? 'folder missing' : `origin ${p.origin ?? '-'}, checkout ${p.checkout ?? '-'}${p.branch ? `, branch ${p.branch}` : ''}${p.clean === false ? ', working tree has changes' : ''}`;
      out.write(`${p.path}  setup ${p.setupVersion ?? '-'}${p.current ? ' (current)' : ''}  ${where}${p.error ? `: ${p.error}` : ''}\n`);
      for (const c of p.changes ?? []) out.write(`  ${c.title}\n`);
    }
    if (!r.projects.length) out.write('no projects: benchkeeper projects add <dir>\n');
    return 0;
  }
  if (cmd === 'projects' && arg === 'update') {
    if (o.baseline && !['auto', ...PROFILES].includes(o.baseline)) { out.write(`--baseline must be auto, ${PROFILES.join(' or ')}\n`); return 2; }
    const max = o.max === undefined ? MAX_PROJECTS : Number(o.max);
    if (!Number.isInteger(max) || max < 1) { out.write('--max must be a whole number of at least 1\n'); return 2; }
    const asked = positionals.slice(2).map(canon), registered = listProjects(ctx);
    const unknown = positionals.slice(2).filter((_, i) => !registered.some((p) => p.path === asked[i]));
    if (unknown.length) { out.write(`${unknown.join(', ')}: not a registered project (benchkeeper projects add <dir>)\n`); return 2; }
    const projects = registered.filter((p) => !asked.length || asked.includes(p.path)).map((p) => ({ ...status(ctx, p.path), unconfirmed: o.unattended ? unconfirmedGit(ctx, p.path) : [] }));
    if (!projects.length) { out.write('no projects: benchkeeper projects add <dir>\n'); return 1; }
    // A checkout behind origin's setup gets its changes from there: Update all starts at origin's default branch.
    const isReady = (p) => !p.unconfirmed.length && p.repo && (p.clean || !(p.share || p.committed)) && !p.error && (p.changes?.length || (p.checkout !== p.setupVersion && !p.current));
    for (const p of projects) {
      const commits = p.share || p.committed, shown = (p.clean || !commits) && p.changes;
      const why = p.unconfirmed.length ? `git config that runs code or sends git elsewhere is not confirmed (${p.unconfirmed.join(', ')}): benchkeeper projects confirm-git ${p.path}, skipped`
        : !p.setupVersion ? 'no state file, skipped' : p.error ?? (!p.repo ? 'not a git repository, skipped' : !p.clean && commits ? 'working tree has changes, skipped'
        : p.changes ? `${p.changes.length} changes` : `setup ${p.setupVersion} on ${p.origin}, checkout ${p.checkout ?? 'without one'}${p.current ? ': pull it' : ''}`);
      out.write(`${p.path}  setup ${p.setupVersion ?? '-'}  ${why}\n`);
      if (shown) p.changes.forEach((c) => out.write(`  ${c.title}${c.kind === 'command' ? `\n    $ ${c.argv.join(' ')}` : ''}\n`));
      if (o['dry-run']) out.projects?.push({ path: p.path, setupVersion: p.setupVersion ?? null, ready: !!isReady(p), reason: why, changes: shown ? p.changes.map(changeDoc) : [] });
    }
    if (o.baseline) {
      for (const p of projects) {
        out.write(`${p.path}  GitHub settings against profile ${o.baseline} (report only)\n`);
        for (const i of baselineIssues(ctx, p.path, { profile: o.baseline, ref: o['baseline-ref'] })) out.write(`  ${(i.tag ?? i.level).padEnd(8)} ${i.message}\n`);
      }
    }
    const ready = projects.filter(isReady);
    if (!ready.length) { out.write('nothing to update\n'); return 0; }
    if (o['dry-run']) { out.write(`dry run: ${ready.length} projects would be updated, nothing changed\n`); return 0; }
    const pushing = o['no-push'] ? 0 : pushTargets(ctx, ready.map((p) => p.path)).length;
    if (pushing > max) { out.write(`${pushing} repositories to push to: Update all pushes to at most ${max} per run (--max N raises it, --no-push stays local)\n`); return 1; }
    const shared = ready.filter((p) => p.share).length;
    const what = `${ready.length} projects: ${ready.length - shared} local in the checkout${shared ? `, ${shared} shared on branch chore/agent-setup-${contentVersion}, one commit${o['no-push'] ? '' : ', git push and gh pr create where origin is on GitHub'}` : ''}`;
    if (!o.yes && !(await ask(`Update ${what}?`))) return 1;
    let results;
    try { results = updateAll(ctx, { paths: ready.map((p) => p.path), push: !o['no-push'], max }); } catch (e) { out.write(`${e.message}\n`); return 1; }
    out.projects?.push(...results);
    out.runs?.push(...results.map((r) => r.run && ctx.ledger.get(r.run)).filter(Boolean));
    for (const r of results) out.write(`${r.status.padEnd(12)} ${r.path}${r.pr ? `  ${r.pr}` : ''}${r.reason ? `: ${r.reason}` : ''}\n`);
    return results.some((r) => r.status === 'stopped') ? 1 : 0;
  }
  if (cmd === 'projects') {
    const dirs = positionals.slice(2);
    if (arg === 'add') dirs.forEach((d) => { const path = addProject(ctx, d, { worktree: o.worktree }); out.projects?.push({ path, status: 'added' }); out.write(`added ${path}\n`); });
    else if (arg === 'scan') for (const d of scan(ctx, dirs[0] ?? '.')) out.write(`found ${d}${listProjects(ctx).some((p) => p.path === canon(d)) ? ' (registered)' : `: benchkeeper projects add ${d}`}\n`);
    else if (arg === 'audit') {
      const t = auditTarget(o, positionals);
      if (t.error) { out.write(`${t.error}\n`); return 2; }
      const r = audit(ctx, t.dir, { only: t.only });
      out.write(auditMarkdown(r));
      return r.summary.error ? 1 : 0;
    }
    else if (arg === 'rename') {
      if (!dirs[0]) { out.write('projects rename needs a directory\n'); return 2; }
      renameProject(ctx, dirs[0], { name: dirs[1] ?? (o.notes === undefined ? '' : undefined), notes: o.notes });
      out.projects?.push({ path: canon(dirs[0]), status: 'renamed' });
      out.write(`renamed ${canon(dirs[0])}\n`);
    }
    else if (arg === 'relocate') {
      if (dirs.length !== 2) { out.write('projects relocate needs the old and the new directory\n'); return 2; }
      const path = relocateProject(ctx, dirs[0], dirs[1]);
      out.projects?.push({ path, from: canon(dirs[0]), status: 'relocated' });
      out.write(`relocated ${canon(dirs[0])} to ${path}\n`);
    }
    else if (arg === 'confirm-git') {
      if (!dirs.length) { out.write('projects confirm-git needs a directory\n'); return 2; }
      // Only the owner confirms: no --yes and no piped answer, so a scheduled session cannot confirm the run it is gated by.
      if (!ask.tty) { out.write('projects confirm-git asks in a terminal: run it yourself\n'); return 2; }
      for (const d of dirs) {
        const found = gitCodeConfig(ctx, canon(d));
        out.write(`${canon(d)}\n${found.map((i) => `  ${i.key.startsWith('hook ') ? i.key : `${i.key} = ${redact(i.value)}`}\n`).join('') || '  none\n'}`);
        if (!(await ask(`Let projects update --unattended run in ${canon(d)} with this config?`))) return 1;
        confirmGit(ctx, d);
        out.projects?.push({ path: canon(d), status: 'confirmed' });
      }
    }
    else if (arg === 'remove' && o.setup) return removeSetups(ctx, dirs, { o, out, ask });
    else if (arg === 'remove') {
      removeProject(ctx, dirs);
      dirs.map(canon).forEach((path) => { out.projects?.push({ path, status: 'removed' }); out.write(`removed ${path}\n`); });
    }
    else if (arg === 'unshare') {
      const max = o.max === undefined ? MAX_PROJECTS : Number(o.max);
      if (!Number.isInteger(max) || max < 1) { out.write('--max must be a whole number of at least 1\n'); return 2; }
      const due = (dirs.length ? dirs.map((d) => registeredEntry(ctx, d).path) : listProjects(ctx).map((p) => p.path)).map((d) => status(ctx, d)).filter((p) => p.committed || dirs.length);
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
  if (cmd === 'sessions' && !['board', 'list', 'cache', 'record'].includes(arg)) { out.write('sessions needs board, list, cache or record\n'); return 2; }
  if (cmd === 'sessions' && arg === 'cache') {
    const c = cacheCommand(ctx, o, positionals);
    if (c.error) { out.write(`${c.error}\n`); return 2; }
    if (c.change) {
      c.lines.forEach((l) => out.write(`${l}\n`));
      if (!o.yes && !(await ask(c.sub === 'clear' ? 'Clear the sessions cache?' : 'Change the retention?'))) return 1;
      c.change();
    }
    const now = sessionCache(ctx);
    out.write(`${now.sessions} session summaries, kept ${kept(now.keepDays)}\n`);
    return 0;
  }
  if (cmd === 'sessions' && arg === 'list') {
    const runs = byRun(await scanSessions(ctx)).filter((x) => o.run === undefined || x.run === o.run);
    if (o.run !== undefined && !runs.length) { out.write(`no sessions of run ${o.run}\n`); return 1; }
    const line = (x) => `${x.sessions} session${x.sessions === 1 ? '' : 's'}, ${x.costUSD == null ? 'cost not recorded' : `$${x.costUSD.toFixed(2)}`}, ${x.tokens} tokens`;
    for (const x of runs) {
      out.write(`run ${x.run ?? 'not recorded'}: ${line(x)}\n`);
      if (o.run !== undefined) for (const t of x.tasks) out.write(`  task ${t.task ?? 'not recorded'}: ${line(t)}\n`);
    }
    if (!runs.length) out.write('no orchestrated sessions\n');
    return 0;
  }
  if (cmd === 'sessions' && arg === 'board') {
    out.write('Reading the transcripts; the first run reads all of them, later runs only new or changed ones.\n');
    const rows = await scanSessions(ctx, { ledger: true, onNote: (n) => out.write(`${n}\n`) });
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
      const origins = o.origins ? shownOrigins(ctx, positionals[2] ? out : err) : [];
      const text = exportProfile(ctx, { agents: selectedAgents(ctx, o.agents), packs: installedPacks(ctx), origins, warn: (m) => err.write(`${m}\n`) });
      if (positionals[2]) { writeAtomic(resolve(positionals[2]), text); out.write(`wrote ${resolve(positionals[2])}\n`); } else out.write(text);
      return 0;
    }
    if (arg !== 'import' || !positionals[2]) { out.write('profile needs export [file] or import <file>\n'); return 2; }
    const p = readProfile(readFileSync(positionals[2], 'utf8'));
    let code = 0;
    // Clones first: a cloned project is registered and set up below like one that was here.
    for (const run of await cloneMissing(ctx, p, { into: o['clone-into'], yes: o.yes, ask, out })) code |= report(run, out);
    // Own packs next: the project plans can name them.
    const done = importChoices(ctx, p);
    out.write(`own packs: ${done.packs.join(', ') || 'none'}\nregistered projects: ${done.projects.join(', ') || 'none'}\n`);
    for (const r of done.refused) out.write(`refused: ${r}\n`);
    const plan = importPlan(ctx, p);
    for (const m of plan.missing) out.write(`skipped ${m}: not on this machine\n`);
    for (const m of plan.skipped) out.write(`skipped ${m}\n`);
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
  if (cmd === 'pins') {
    if (arg !== undefined && arg !== 'list') { out.write('pins needs list\n'); return 2; }
    const dir = resolve(positionals[2] ?? '.');
    if (!isDir(dir)) { out.write(`${dir} is not a folder\n`); return 2; }
    const { pins, errors } = resolvePins(dir);
    for (const e of errors) out.write(`${e.file}: ${e.rule}${e.path ? ` at ${e.path}` : ''}: ${e.message}\n`);
    if (errors.length) return 1;
    for (const p of pins) out.write(`${p.phase.padEnd(10)} ${(p.agent ?? 'session').padEnd(8)} ${(p.model ?? 'default').padEnd(24)} ${(p.effort ?? 'default').padEnd(8)} ${p.source}\n`);
    return 0;
  }
  if (cmd === 'accounts') return accountsCommand(ctx, { o, positionals, out, ask });
  if (cmd === 'run') return runAccountCommand({ o, positionals, out, ctx, ask });
  if (cmd === 'rules') return rulesCommand({ o, positionals, out, ask, ctx });
  if (cmd === 'automations') return automationsCommand(ctx, { o, positionals, out, ask });
  if (cmd === 'webhook') return webhookCommand(ctx, { o, positionals, out, ask });
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
  if (cmd === 'evals' && arg === 'results') {
    if (positionals.length > 2) { out.write(`unexpected argument ${positionals[2]}\n`); return 2; }
    const results = evalResults(ctx);
    for (const r of results) out.write(`${r.time?.slice(0, 16).replace('T', ' ') ?? '-'}  ${resultLine(r)}\n`);
    if (!results.length) out.write('no eval results: benchkeeper evals run\n');
    return 0;
  }
  if (cmd === 'evals') {
    if (arg !== 'plan' && arg !== 'run') { out.write('evals needs plan, run, results or cases add\n'); return 2; }
    if (arg === 'run' && process.env.CI) { out.write('evals run starts agent sessions on a subscription and does not run in CI\n'); return 2; }
    const plan = evalPlan(ctx, { agents: o.agents?.split(',') ?? ['claude'], model: o.model, all: o.all, only: o.target });
    const sessions = plan.reduce((n, p) => n + p.cases.length, 0);
    if (!plan.length) { out.write('every target is unchanged since its last result (--all runs them again)\n'); return 0; }
    for (const p of plan) out.write(`${p.target}  ${p.agent}${p.model ? ` ${p.model}` : ''}  ${p.cases.length} cases${p.project ? `  (project ${p.project})` : ''}\n`);
    if (arg === 'plan') return 0;
    if (!o.yes && !(await ask(`Start ${sessions} agent sessions?`))) return 1;
    for (const r of await runEval(ctx, plan)) {
      const review = r.details.find((d) => d.review)?.review;
      out.write(`${resultLine(r)}${review ? `  review: ${review.slice(0, review.lastIndexOf('/') + 1)}` : ''}\n`);
    }
    return 0;
  }
  if (cmd === 'history' && arg === 'show') {
    if (!positionals[2] || positionals.length > 3) { out.write(positionals[2] ? `unexpected argument ${positionals[3]}\n` : 'history show needs a run, see benchkeeper history\n'); return 2; }
    let run;
    try { run = runReport(ctx, positionals[2]); } catch (e) { out.write(`${e.message}\n`); return 1; }
    out.write(`${run.id}  ${run.kind} ${run.status ?? 'interrupted'}  ${run.scope}${run.of ? ` (undo of ${run.of})` : ''}\n`);
    for (const e of run.entries) {
      out.write(`${(e.status ?? '').padEnd(7)} ${e.title}${e.removed ? ' (removed)' : ''}${e.folder ? ' (folder)' : ''}${e.error || e.reason ? `: ${e.error ?? e.reason}` : ''}\n`);
      for (const f of e.files ?? []) out.write(`  ${f.status} ${f.path}\n${indent(f.diff)}`);
      out.write(indent(e.diff));
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
    return report(undo(arg, uctx, { step: o.step, unit: o.unit }), out);
  }
  if (cmd === 'inventory' || cmd === 'dashboard') {
    if (positionals.length > 1) { out.write(`unexpected argument ${positionals[1]}\n`); return 2; }
    const { items, board } = machineItems(ctx, o, cmd);
    if (cmd === 'inventory') { for (const i of items) out.write(`${i.state.padEnd(9)} ${i.agent.padEnd(8)} ${i.title}\n`); return 0; }
    const states = (c) => Object.entries(c).filter(([, n]) => n).map(([st, n]) => `${st} ${n}`).join(', ') || 'no items';
    out.write(`machine  ${states(board.global.states)}\n`);
    for (const p of board.projects) out.write(`${p.path}  ${p.error ? `error: ${p.error}` : !p.setup ? 'no setup' : `${states(p.states)}${p.untracked ? `, untracked ${p.untracked}` : ''}  packs ${p.packs.join(', ') || 'none'}`}\n`);
    return 0;
  }
  out.write(`unknown command ${cmd}\n\n${HELP}\n`);
  return 2;
}

// The global items with their state and, for dashboard, the Dashboard built on them.
function machineItems(ctx, o, cmd) {
  const agents = selectedAgents(ctx, o.agents), items = inventory(ctx, agents, { level: levelFor(ctx, agents) });
  return { items, ...(cmd === 'dashboard' ? { board: dashboard(ctx, agents, items) } : {}) };
}

// extra: more answers (packOn, reset, ...); focus: skill names, the plan then holds only their changes.
function planProject(ctx, o, dir, { focus, ...extra } = {}) {
  const pctx = projectCtx(ctx, dir);
  const answers = { agents: o.agents?.split(','), env: o.env, sandbox: o.sandbox, guards: o['no-guards'] ? false : o.guards ? true : undefined, share: o.share ? true : o.local ? false : undefined, packs: o.pack, skills: o.skill, tier: o.tier, callers: o.caller, agentFiles: o['agent-file']?.filter((f) => f !== 'none'), ...extra };
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
  const plan = preview(globalPlan({ ctx, agents, options: { packs, packsInUse: [], drop: on ? [] : ids, level: 'full' } })).filter((c) => steps.has(c.step)).map((c) => ({ ...c, selected: true, foreign: false }));
  for (const id of on ? [] : ids) { const users = projectsUsing(ctx, id); if (users.length) out.write(`note: ${users.join(', ')} still name${users.length === 1 ? 's' : ''} ${id}\n`); }
  return applyChosen(plan, ctx, { o, ask, out });
}

// packs scope <id> [global|projects]: the pack's scope and what each agent offers, or a plan that moves its installs.
async function packScopeCommand(ctx, { o, positionals, out, ask }) {
  const [, , id, scope] = positionals;
  const pack = libraryWith(ctx).packs.find((p) => p.id === id);
  if (!pack) { out.write(`unknown pack ${id ?? ''}, see benchkeeper packs list\n`); return id ? 1 : 2; }
  const agents = selectedAgents(ctx, o.agents);
  if (!scope) out.write(`${id}: ${packScope(ctx, pack)} (${scopeText(packScope(ctx, pack))})\n`);
  for (const a of agents) {
    const offer = packScopes(pack, a);
    if (offer && (!scope || offer.fixed)) out.write(`  ${agent(a).name}: ${offer.fixed ? `${offer.scopes[0]} only: ${offer.fixed}` : offer.scopes.join(', ')}\n`);
  }
  if (!scope) return 0;
  const plan = preview(scopePlan(ctx, id, scope, agents));
  if (!plan.length) { out.write('nothing to change\n'); return 0; }
  // Each project's changes run under its own bounds as a run of their own, as a projects apply does: a project outside
  // the home folder is outside the global ones. A project that cannot be one stops the move before any change.
  let sections;
  try { sections = [['global', ctx], ...[...new Set(plan.map((c) => c.project).filter(Boolean))].map((p) => [p, projectCtx(ctx, p)])]; } catch (e) { out.write(`${e.message}\n`); return 1; }
  const select = await choose(plan, o, ask, out);
  let code = 0;
  for (const [where, sctx] of sections) {
    const changes = plan.filter((c) => (c.project ?? 'global') === where);
    if (where === 'global' || changes.some((c) => select.includes(c.id))) code = Math.max(code, report(apply(changes, sctx, { scope: where, select }), out));
  }
  return code;
}

// A global plan: nothing to change, or the changes chosen applied as one run.
async function applyChosen(plan, ctx, { o, ask, out }) {
  if (!plan.length) { out.write('nothing to change\n'); return 0; }
  return report(apply(plan, ctx, { scope: 'global', select: await choose(plan, o, ask, out) }), out);
}

const SKILL_ACTIONS = ['update', 'reset', 'remove', 'adopt', 'add', 'enable', 'disable'];
// skills list|update|reset|remove|adopt|add|enable|disable: the Catalog's skill management, through the same plan, diff and undo.
async function skillsCommand(ctx, { o, positionals, out, ask }) {
  const [, sub = 'list', ...names] = positionals;
  const dir = resolve(o.project ?? '.');
  if (sub !== 'list' && !SKILL_ACTIONS.includes(sub)) { out.write(`skills needs list, show, ${SKILL_ACTIONS.join(', ')}\n`); return 2; }
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
  if (['add', 'enable', 'disable'].includes(sub) && !names.length) { out.write(`skills ${sub} needs a skill name\n`); return 2; }
  let action;
  try { action = skillAction(rows, sub, names, libraryWith(ctx)); } catch (e) { out.write(`${e.message}\n`); return 1; }
  if (!action.names.length) { out.write('nothing to change\n'); return 0; }
  return runProjectPlan(ctx, dir, { o, out, ask }, planProject(ctx, o, dir, { ...action.answers, focus: action.names, partial: true }));
}

// ---- --json: one document on stdout, logs on stderr. Exit 0 clean, 1 findings of level error, 2 usage or read failure.
// A document never holds file contents or values of environment variables: changes list title, kind and path, not the diff.

const JSON_SCHEMA_VERSION = 1;
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
const commandName = (cmd, arg, sub) => (cmd === 'sessions' && arg === 'cache' ? `sessions cache ${sub ?? 'show'}` : cmd === 'history' && arg === 'show' ? 'history show' : ['projects', 'packs', 'skills', 'rules', 'extensions', 'settings', 'profile', 'accounts', 'knowledge', 'sessions', 'evals', 'automations'].includes(cmd) ? `${cmd} ${arg ?? 'list'}` : cmd);
const count = (list, level) => list.filter((i) => i.level === level).length;

// The commands that change the machine or a repository: under --json they print what they did, not what they read.
const changing = (cmd, arg) => ['apply', 'undo'].includes(cmd) || (cmd === 'projects' && ['apply', 'add', 'confirm-git', 'remove', 'rename', 'relocate', 'update'].includes(arg))
  || (cmd === 'settings' && arg === 'set') || (['rules', 'packs'].includes(cmd) && ['enable', 'disable'].includes(arg)) || (cmd === 'packs' && arg === 'scope') || (cmd === 'skills' && arg === 'update')
  || (cmd === 'automations' && ['install', 'update', 'remove'].includes(arg));
const entryDoc = (e) => ({ step: e.step, title: e.title, kind: e.kind, status: e.status, ...(e.installUnit ? { unit: e.installUnit } : {}), ...(e.reason ? { reason: redact(e.reason) } : {}), ...(e.error ? { error: redact(e.error) } : {}) });
const runDoc = (r) => ({ id: r.id, kind: r.kind, scope: r.scope, status: r.status, entries: r.entries.map(entryDoc) });
// A project's setup state as projects status prints it: the pending changes without their diffs.
const statusDoc = ({ changes, error, ...p }) => ({ ...p, changes: changes?.map(changeDoc) ?? null, error: error ? redact(error) : null });
const projectDoc = ({ reason, ...p }) => ({ ...p, ...(reason ? { reason: redact(reason) } : {}) });

// A changing command runs as in the terminal with its lines on stderr; a question it would ask is refused before
// anything changes, so a script never waits: --yes answers it. stdout gets one document with the runs it made.
async function changeJson(argv, { cmd, arg, out, err, ctx }) {
  const name = commandName(cmd, arg), lines = [];
  const log = { write: (s) => { lines.push(s); err.write(s); }, runs: [], ...(cmd === 'projects' && arg !== 'apply' ? { projects: [] } : {}) };
  const refuse = () => { throw new Error(`${name} asks before it changes anything: add --yes to run it with --json`); };
  refuse.line = refuse;
  let code, error;
  try { code = await command(argv.filter((a) => a !== '--json'), { out: log, err, ask: refuse, ctx }); } catch (e) { code = 2; error = e.message; err.write(`${redact(e.message)}\n`); }
  const made = log.runs.length || log.projects?.length;
  // A command that stops before a change prints why as its last line; with nothing made that is a usage or read failure.
  if (code && !made) { error ??= lines.at(-1)?.trim(); code = 2; }
  const doc = { runs: log.runs.map(runDoc), ...(log.projects ? { projects: log.projects.map(projectDoc) } : {}) };
  out.write(jsonDoc(name, error && !made ? { error: redact(error) } : { ...doc, ...(error ? { error: redact(error) } : {}) }));
  return code;
}

async function jsonCommand({ cmd, arg, o, positionals, out, err, ctx }) {
  const name = commandName(cmd, arg, positionals[2]);
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
  if (cmd === 'history' && arg === 'show') {
    if (!positionals[2]) return fail('history show needs a run, see benchkeeper history');
    const extra = surplus(3); if (extra !== undefined) return extra;
    let run;
    try { run = runReport(ctx, positionals[2]); } catch (e) { return fail(e.message); }
    // The diffs are file contents: a document lists each file, not its diff.
    const entries = run.entries.map((e) => ({ ...entryDoc(e), ...(e.path ? { path: e.path } : {}), ...(e.removed ? { removed: true } : {}), ...(e.folder ? { folder: true } : {}), ...(e.files ? { files: e.files.map((f) => ({ status: f.status, path: f.path })) } : {}) }));
    return emit({ run: { id: run.id, kind: run.kind, status: run.status ?? 'interrupted', scope: run.scope, time: run.time, ...(run.of ? { of: run.of } : {}), entries } });
  }
  if (cmd === 'history') {
    const runs = ctx.ledger.list().map((r) => ({ id: r.id, kind: r.kind, status: r.status ?? 'interrupted', scope: r.scope, time: r.time, changes: r.entries.length, ...(r.of ? { of: r.of } : {}), ...(r.note?.case ? { evalCase: r.note.case, target: r.note.target } : {}) }));
    return emit({ runs, backups: legacyBackups(ctx) });
  }
  if (cmd === 'projects' && arg === 'status') {
    const broken = registryFail();
    if (broken !== undefined) return broken;
    const r = await projectsStatus(ctx, positionals);
    if (r.error) return fail(r.error);
    return emit({ version: r.version, level: r.level.level ?? null, adds: r.level.adds ?? null, agents: r.agents, projects: r.projects.map(statusDoc) });
  }
  if (cmd === 'projects' && (!arg || arg === 'list')) return surplus(2) ?? registryFail() ?? emit({ projects: listProjects(ctx).map((p) => ({ path: p.path, added: p.added })) });
  if (cmd === 'automations') {
    const r = await automationsDoc(ctx, arg, positionals, o);
    return r.error ? fail(r.error) : emit(r.doc, r.code ?? 0);
  }
  if (textRead(cmd, arg)) {
    const r = await readDoc(ctx, { cmd, o, positionals, err });
    return r.error ? fail(r.error) : emit(r.doc);
  }
  if (cmd === 'packs' && arg === 'show') {
    const extra = surplus(3); if (extra !== undefined) return extra;
    const pack = catalog(ctx).packs.find((x) => x.id === positionals[2]);
    return pack ? emit({ pack }) : fail(`unknown pack ${positionals[2] ?? ''}, see benchkeeper packs list`);
  }
  if (cmd === 'skills' && o.library && (!arg || arg === 'list')) return surplus(2) ?? emit({ skills: catalog(ctx).skills });
  if (cmd === 'packs' && (!arg || arg === 'list')) return surplus(2) ?? emit({ packs: libraryWith(ctx).packs.map((p) => ({ id: p.id, own: !!p.own, scope: packScope(ctx, p), skills: p.skills ?? [], plugins: Object.values(p.plugins ?? {}).map((x) => x.id) })) });
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
  if (cmd === 'rules' && arg === 'check') {
    const extra = surplus(2); if (extra !== undefined) return extra;
    const opts = rulesCheckOptions(ctx, o);
    if (opts.error) return fail(opts.error);
    const found = rulesChecks(ctx, opts);
    return emit({ dir: opts.dir ?? null, limit: opts.limit, findings: found.map(finding), summary: { error: count(found, 'error'), warning: count(found, 'warning') } }, count(found, 'error') ? 1 : 0);
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
  if (cmd === 'skills' && arg === 'sources') return surplus(positionals[2] === 'list' ? 3 : 2) ?? emit({ sources: sourceRows() });
  if (cmd === 'projects' && arg === 'scan') {
    const extra = surplus(3); if (extra !== undefined) return extra;
    const broken = registryFail();
    if (broken !== undefined) return broken;
    const registered = listProjects(ctx).map((p) => p.path);
    return emit({ root: canon(positionals[2] ?? '.'), found: scan(ctx, positionals[2] ?? '.').map((path) => ({ path, registered: registered.includes(canon(path)) })) });
  }
  if (cmd === 'sessions' && arg === 'list') {
    const extra = surplus(2); if (extra !== undefined) return extra;
    const runs = byRun(await scanSessions(ctx)).filter((x) => o.run === undefined || x.run === o.run);
    return o.run !== undefined && !runs.length ? fail(`no sessions of run ${o.run}`) : emit({ runs });
  }
  if (cmd === 'sessions' && arg === 'cache') {
    const c = cacheCommand(ctx, o, positionals);
    if (c.error) return fail(c.error);
    if (c.change) {
      c.lines.forEach((l) => err.write(`${l}\n`));
      if (!o.yes) return fail(`sessions cache ${c.sub} asks before it changes anything: add --yes to run it with --json`);
      c.change();
    }
    return emit(sessionCache(ctx));
  }
  if (cmd === 'sessions' && arg === 'board') {
    const extra = surplus(2); if (extra !== undefined) return extra;
    // Nothing is written or opened; the title is left out because it quotes the first message of a session.
    const notes = [];
    const sessions = (await scanSessions(ctx, { ledger: true, onNote: (n) => notes.push(n) })).map(({ title, ...s }) => s);
    return emit({ sessions, ...(notes.length ? { notes } : {}) });
  }
  if (cmd === 'projects' && arg === 'audit') {
    const t = auditTarget(o, positionals);
    if (t.error) return fail(t.error);
    const r = audit(ctx, t.dir, { only: t.only });
    return emit(r, r.summary.error ? 1 : 0);
  }
  if (cmd === 'insights') {
    const extra = surplus(1); if (extra !== undefined) return extra;
    const broken = registryFail();
    if (broken !== undefined) return broken;
    const found = await collectInsights(ctx, { agents: selectedAgents(ctx, o.agents), dir: o.project && resolve(o.project) });
    if (!o.narrative) return emit(found, found.summary.error ? 1 : 0);
    // The narrative starts an agent session on your login: the flag, an agent and, for a new run, --yes. The input goes to stderr first.
    if (!ADVISERS.includes(o.agent)) return fail(`--narrative needs --agent ${ADVISERS.join(' or ')}`);
    // The findings the Insights view shows, so the view and the command share one cached narrative.
    const shown = shownFindings(ctx, found.findings);
    if (!shown.length) return fail('no findings to summarize');
    const key = narrativeKey(shown), cached = readNarrative(ctx, key), input = narrativeInput(found, shown);
    // The ids the text covers: the findings the view shows and the prompt carries (the findings array above lists all of them).
    const covers = input.findings.map((f) => f.id);
    if (cached && !o.yes) return emit({ ...found, narrative: { ...cached, covers, cached: true } }, found.summary.error ? 1 : 0);
    const { prompt, size } = narrativePrompt(input, key);
    err.write(`${prompt}\n`);
    if (!o.yes) return fail(`the narrative sends the ${size} characters above to ${o.agent} in one session: add --yes to run it`);
    if (process.env.CI) return fail('the narrative starts an agent session on a subscription and does not run in CI');
    try { return emit({ ...found, narrative: { ...(await runNarrative(ctx, { agent: o.agent, prompt, key })), covers, cached: false } }, found.summary.error ? 1 : 0); } catch (e) { return fail(e.message); }
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
    if (arg !== 'status') return emit({ accounts: picked.map((a) => ({ ...accountDoc(a, registrySettings(ctx)), loggedIn: accountStatus(ctx, a, { usage: false }).loggedIn })), settings: { ...settingsOf(registrySettings(ctx)), warn: limitsFor(registrySettings(ctx)).warn } });
    const accounts = picked.map((a) => accountStatus(ctx, a, { dir: o.project ? resolve(o.project) : undefined }));
    return emit({ accounts }, accounts.some((a) => a.findings.some((f) => f.level === 'error')) ? 1 : 0);
  }
  if (cmd === 'evals' && ['plan', 'run'].includes(arg)) {
    if (arg === 'run' && process.env.CI) return fail('evals run starts agent sessions on a subscription and does not run in CI');
    const plan = evalPlan(ctx, { agents: o.agents?.split(',') ?? ['claude'], model: o.model, all: o.all, only: o.target });
    // Case ids only: a query or expected text can quote a transcript.
    const doc = { plan: plan.map((p) => ({ target: p.target, agent: p.agent, model: p.model ?? null, cases: p.cases.map((c) => c.id), ...(p.project ? { project: p.project } : {}) })) };
    if (arg === 'plan' || !plan.length) return emit(doc);
    if (!o.yes) { const message = `evals run starts ${doc.plan.reduce((n, p) => n + p.cases.length, 0)} agent sessions: add --yes to run it with --json`; err.write(`${message}\n`); return emit({ ...doc, error: message }, 2); }
    const results = [];
    let error;
    try { await runEval(ctx, plan, { onResult: (r) => results.push(r) }); } catch (e) { error = redact(e.message); err.write(`${error}\n`); }
    const resultDoc = ({ details, ...r }) => ({ ...r, details: details.map(({ expected, ...d }) => d) });
    return emit({ ...doc, results: results.map(resultDoc), ...(error ? { error } : {}) }, error ? 1 : 0);
  }
  if (cmd === 'evals' && arg === 'results') return surplus(2) ?? emit({ results: evalResults(ctx) });
  if (cmd === 'inventory' || cmd === 'dashboard') {
    const extra = surplus(1); if (extra !== undefined) return extra;
    const { items, board } = machineItems(ctx, o, cmd);
    return emit(cmd === 'inventory' ? { items } : { ...board, projects: board.projects.map((p) => ({ ...p, error: p.error ? redact(p.error) : null })) });
  }
  if (cmd === 'profile' && arg === 'export') {
    if (positionals[2]) return fail('profile export --json prints the document: redirect stdout and take `.profile` before profile import');
    const broken = registryFail();
    if (broken !== undefined) return broken;
    return emit({ profile: JSON.parse(exportProfile(ctx, { agents: selectedAgents(ctx, o.agents), packs: installedPacks(ctx), origins: o.origins ? projectOrigins(ctx, listProjects(ctx).map((x) => x.path)) : [], warn: (m) => err.write(`${m}\n`) })) });
  }
  return fail('--json works with doctor, verify, plan, projects plan, history and history show, projects list, status, scan, audit and advise, packs list, show and warnings, skills list, show and sources, rules list, show and check, extensions list, settings list and get, sessions board, list and cache, insights, profile export, knowledge show, accounts list and status, evals plan, run and results, inventory, dashboard, and the changing commands apply, projects apply, add, remove, rename, relocate and update, settings set, rules and packs enable and disable, skills update and undo');
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

// The agents, project and file size limit of rules check, or { error }.
function rulesCheckOptions(ctx, o) {
  if (o.agent && !RULE_AGENTS.includes(o.agent)) return { error: `agent must be one of ${RULE_AGENTS.join(', ')}` };
  if (o.limit !== undefined && !/^[1-9]\d*$/.test(o.limit)) return { error: '--limit must be a whole number of tokens above 0' };
  const found = selectedAgents(ctx, o.agents).filter((a) => RULE_AGENTS.includes(a));
  return { agents: o.agent ? [o.agent] : found.length ? found : RULE_AGENTS, dir: o.project ? resolve(o.project) : undefined, limit: o.limit ? Number(o.limit) : BUDGET_TOKENS };
}

// rules list|check|disable|enable: the Rules view on the command line, through the same plan, diff and undo.
async function rulesCommand({ o, positionals, out, ask, ctx }) {
  const [, sub, file] = positionals;
  if (!['list', 'check', 'disable', 'enable'].includes(sub)) { out.write('rules needs list, show, check, disable or enable\n'); return 2; }
  if (o.agent && !RULE_AGENTS.includes(o.agent)) { out.write(`agent must be one of ${RULE_AGENTS.join(', ')}\n`); return 2; }
  const dir = o.project ? resolve(o.project) : undefined;
  if (sub === 'check') {
    const opts = rulesCheckOptions(ctx, o);
    if (opts.error) { out.write(`${opts.error}\n`); return 2; }
    const found = rulesChecks(ctx, opts);
    for (const i of found) out.write(`${i.level.padEnd(8)} ${i.message}\n        fix: ${i.fix}\n`);
    out.write(found.length ? `${count(found, 'error')} errors, ${count(found, 'warning')} warnings\n` : 'no problems found\n');
    return count(found, 'error') ? 1 : 0;
  }
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

// ---- automations: templates (automations.mjs) installed on the runner

// --param name=value options as { values } or { error }.
function paramValues(list = []) {
  const values = {};
  for (const p of list) {
    const at = p.indexOf('=');
    if (at < 1) return { error: `--param ${p}: name=value` };
    values[p.slice(0, at)] = p.slice(at + 1);
  }
  return { values };
}

// list, show, diff, status and precheck as a document, or { error, code } (the terminal prints it; 2: usage).
async function automationsDoc(ctx, sub = 'list', positionals, o = {}) {
  const id = positionals[2];
  if (positionals.length > (['show', 'diff', 'precheck'].includes(sub) ? 3 : 2)) return { error: `unexpected argument ${positionals.at(-1)}`, code: 2 };
  if (['show', 'diff', 'precheck'].includes(sub) && !id) return { error: `automations ${sub} needs a template id, see benchkeeper automations list`, code: 2 };
  if (o.param && sub !== 'precheck') return { error: '--param belongs to automations install and precheck', code: 2 };
  if (sub === 'precheck') {
    const { values, error } = paramValues(o.param);
    if (error) return { error, code: 2 };
    // Exit 0: work, 1: none, 2: a refusal (no policy, no runner, a failing read) or a usage error.
    try {
      const r = await precheck(ctx, id, values, resolve(o.project ?? '.'));
      return { doc: { id, work: r.work, skipped: r.skipped }, code: r.work.length ? 0 : 1 };
    } catch (e) { return { error: e.message, code: 2 }; }
  }
  try {
    if (sub === 'list') {
      const { templates, errors } = loadAutomations(ctx), installed = readRegistry(ctx);
      return { doc: { templates: templates.map((t) => ({ id: t.id, tier: t.tier, title: t.title, agent: t.agent, schedule: t.schedule, installed: !!installed[t.id] })), errors } };
    }
    if (sub === 'show') {
      const t = loadAutomations(ctx).templates.find((x) => x.id === id);
      if (!t) return { error: `no automation template ${id}, see benchkeeper automations list`, code: 1 };
      const keys = ['id', 'tier', 'title', 'agent', 'schedule', 'workspace', 'reuse_session', 'precheck', 'missed_run_grace_minutes', 'mode', 'parameters', 'helpers', 'prompt'];
      return { doc: { template: Object.fromEntries(keys.map((k) => [k, t[k]])) } };
    }
    if (sub === 'diff') { const d = automationDiff(ctx, id); return { doc: { id, diff: d.diff, note: d.note } }; }
    if (sub === 'status') {
      const rows = automationStatus(ctx);
      return { doc: { automations: rows }, code: rows.some((r) => r.state !== 'current') ? 1 : 0 };
    }
  } catch (e) { return { error: e.message, code: 1 }; }
  return { error: 'automations needs list, show, install, update, remove, diff, status or precheck', code: 2 };
}

async function automationsCommand(ctx, { o, positionals, out, ask }) {
  const [, sub = 'list', id] = positionals;
  if (['install', 'update', 'remove'].includes(sub)) {
    if (!id) { out.write(`automations ${sub} needs a template id\n`); return 2; }
    if (o.param && sub !== 'install') { out.write('--param belongs to automations install and precheck\n'); return 2; }
    const { values, error } = paramValues(o.param);
    if (error) { out.write(`${error}\n`); return 2; }
    let plan;
    try { plan = preview(sub === 'install' ? installChanges(ctx, id, { values, dir: o.project ?? '.' }) : sub === 'update' ? updateChanges(ctx, id) : removeChanges(ctx, id)); } catch (e) { out.write(`${e.message}\n`); return 1; }
    return applyChosen(plan, ctx, { o, ask, out });
  }
  const r = await automationsDoc(ctx, sub, positionals, o);
  if (r.error) { out.write(`${r.error}\n`); return r.code; }
  const d = r.doc;
  if (sub === 'list') {
    for (const t of d.templates) out.write(`${t.id.padEnd(24)} ${t.tier.padEnd(8)} ${(t.installed ? 'installed' : '').padEnd(10)} ${t.title}\n`);
    for (const e of d.errors) out.write(`error    ${e.file}: ${e.message}\n`);
    if (!d.templates.length && !d.errors.length) out.write('no automation templates\n');
  } else if (sub === 'show') {
    const t = d.template;
    out.write(`${t.id} (${t.tier}): ${t.title}\nagent ${t.agent}, schedule ${t.schedule || 'none'}, workspace ${t.workspace}, mode ${t.mode}\nprecheck: ${t.precheck}\n`);
    for (const [k, p] of Object.entries(t.parameters)) out.write(`--param ${k}=${p.default ?? '(required)'}  ${p.description}\n`);
    out.write(`\n${t.prompt}\n`);
  } else if (sub === 'precheck') for (const l of [...d.work, ...d.skipped]) out.write(`${l}\n`);
  else if (sub === 'diff') out.write(`${d.note ? `${d.note}\n` : ''}${d.diff || 'the installed automation matches the template\n'}`);
  else {
    for (const a of d.automations) out.write(`${a.id.padEnd(24)} ${a.state.padEnd(9)} ${a.enabled === null ? '' : a.enabled ? 'enabled ' : 'disabled'} ${a.changed.length ? `changed: ${a.changed.join(', ')}` : ''}${a.note ? ` ${a.note}` : ''}\n`);
    if (!d.automations.length) out.write('no automation installed\n');
  }
  return r.code ?? 0;
}

// ---- webhook: the run notification (webhook.mjs)

async function webhookCommand(ctx, { o, positionals, out, ask }) {
  const [, sub] = positionals;
  if (!['set', 'remove', 'status', 'send'].includes(sub)) { out.write('webhook needs set, remove, status or send\n'); return 2; }
  if (positionals.length > 2) { out.write(`unexpected argument ${positionals[2]}\n`); return 2; }
  if (sub !== 'send' && [o.state, o.run, o.automation, o.task].some((v) => v !== undefined)) { out.write('--state, --run, --automation and --task belong to webhook send\n'); return 2; }
  try {
    if (sub === 'send') {
      // A run calls this last: only bad arguments fail it, a missing webhook or store does not.
      const r = sendWebhook(ctx, { state: o.state, run: o.run, automation: o.automation, task: o.task });
      out.write(r.sent ? `sending, at most ${TIMEOUT / 1000} seconds; a failure goes to ${logFile(ctx)}\n` : 'no webhook set: nothing sent\n');
      return 0;
    }
    if (sub === 'status') {
      const s = webhookStatus(ctx);
      out.write(`configured: ${s.configured ? 'yes' : 'no'}${s.store ? ` (${s.store}, entry ${ENTRY})` : `: ${s.note}`}\nlast failure: ${s.lastFailure ?? 'none'}\n`);
      return 0;
    }
    if (sub === 'set') {
      // Never an argument and never typed with an echo: the URL can hold a secret of its own.
      if (ask.tty) { out.write('pipe the URL, and a token on a second line, on stdin: printenv HOOK | benchkeeper webhook set\n'); return 2; }
      const url = ((await ask.line('')) ?? '').trim(), token = ((await ask.line('')) ?? '').trim() || undefined;
      const r = setWebhook(ctx, url, token);
      out.write(`${r.replaced ? 'replaced the webhook' : 'webhook kept'} in the OS credential store (${r.store}, entry ${ENTRY}); webhook remove deletes it\n`);
      return 0;
    }
    if (!webhookStatus(ctx).configured) { out.write('no webhook set\n'); return 0; }
    if (!o.yes && !(await ask('Delete the webhook from the OS credential store? Runs then send nothing.'))) return 1;
    removeWebhook(ctx);
    out.write('deleted the webhook\n');
    return 0;
  } catch (e) {
    out.write(`${e.message}\n`);
    return e instanceof UsageError ? 2 : 1;
  }
}

// ---- accounts: the registry, the guided sign-in and the launcher (accounts.mjs)

const accountLine = (a) => `${a.name.padEnd(16)} ${a.agent.padEnd(7)} ${(a.mode === 'host' ? 'host' : 'container').padEnd(9)} ${(a.default ? 'default' : '').padEnd(8)} ${a.mode === 'host' ? a.dir : `volume ${a.volume} at ${a.mount}`}${a.label ? `  ${mask(a.label)}` : ''}${a.pool ? `  pool ${a.pool}` : ''}${a.token ? `  token kept since ${a.token.created.slice(0, 10)}` : ''}`;

const loginText = (s) => (s.loggedIn === null ? 'not checked' : s.loggedIn ? `signed in${s.method ? ` (${s.method})` : ''}` : 'not signed in');

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
  for (const agent of AGENTS) {
    const v = o[`rotate-${agent}`];
    if (v === undefined) continue;
    if (!ROTATE.includes(v)) throw new Error(`--rotate-${agent} is ${ROTATE.join(' or ')}`);
    out.rotate = { ...out.rotate, [agent]: v };
  }
  if (name && ['autoPick', 'continueBelow', 'whenNone', 'rotate'].some((k) => out[k] !== undefined)) throw new Error('--auto-pick, --when-none, --continue-below and --rotate-<agent> are settings for all accounts: leave out the account name');
  if (!name && (out.pool !== undefined || o.reset)) throw new Error('--pool and --reset belong to one account: give its name');
  out.reset = !!o.reset;
  return out;
}
const limitsShown = (ctx) => {
  const settings = registrySettings(ctx), all = settingsOf(settings), l = limitsFor(settings);
  const text = (x) => WINDOWS.map(([k, label]) => `${label} ${x.minimum[k]}% (notice below ${x.warn[k]}%)`).join(', ');
  return [`defaults: minimum headroom ${text(l)}`,
    `auto-pick ${all.autoPick ? 'on' : 'off'}; when no pool member has headroom: ${all.whenNone}; below the minimum run ${all.continueBelow ? 'starts anyway' : 'asks'}`,
    `rotation: ${AGENTS.map((g) => `${g} ${all.rotate[g]}`).join(', ')}`,
    ...listAccounts(ctx).filter((a) => a.limits || a.pool).map((a) => `${a.name}: ${a.limits ? `minimum headroom ${text(limitsFor(settings, a))}` : 'defaults'}${a.pool ? `; pool ${a.pool}` : ''}`)];
};

async function accountsCommand(ctx, { o, positionals, out, ask }) {
  const [, sub = 'list', name] = positionals;
  const subs = ['list', 'add', 'use', 'remove', 'status', 'login', 'track', 'limits', 'handover'];
  if (!subs.includes(sub)) { out.write(`accounts needs ${subs.join(', ')}\n`); return 2; }
  if (positionals.length > 3) { out.write(`unexpected argument ${positionals[3]}\n`); return 2; }
  const problem = accountsProblem(ctx);
  if (problem) { out.write(`${problem}\n`); return 2; }
  const need = () => { if (!name) { out.write(`accounts ${sub} needs an account name, see benchkeeper accounts list\n`); return false; } return true; };
  try {
    if (sub === 'list') {
      const list = listAccounts(ctx);
      for (const a of list) out.write(`${accountLine(a)}  ${loginText(accountStatus(ctx, a, { usage: false }))}\n`);
      if (!list.length) out.write('no accounts: benchkeeper accounts add\n');
      return 0;
    }
    if (sub === 'status') {
      const list = name ? [findAccount(ctx, name)] : listAccounts(ctx);
      let code = 0;
      for (const a of list) {
        const s = accountStatus(ctx, a, { dir: o.project ? resolve(o.project) : undefined });
        out.write(`${a.name.padEnd(16)} ${a.agent.padEnd(7)} ${loginText(s)}${s.tokenAgeDays !== undefined ? `  token ${s.tokenAgeDays} days old` : ''}\n`);
        if (s.usage) out.write(`${usageText(s.usage, a.name)}\n`);
        else if (s.notAvailable) out.write(`  usage    ${s.notAvailable}\n`);
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
    if (sub === 'handover') {
      if (!need()) return 2;
      return (await handoverFlow(ctx, findAccount(ctx, name), { dir: resolve(o.project ?? '.'), yes: !!o.yes, ask, out })) ?? 0;
    }
    let change, entry, gone;
    if (sub === 'limits') {
      const flags = limitFlags(o, name), given = Object.values({ ...flags.minimum, ...flags.warn }).length || ['pool', 'autoPick', 'whenNone', 'continueBelow', 'rotate'].some((k) => flags[k] !== undefined) || flags.reset;
      if (name) findAccount(ctx, name);
      if (!given) { limitsShown(ctx).forEach((l) => out.write(`${l}\n`)); return 0; }
      change = name ? limitsChange(ctx, name, flags) : settingsChange(ctx, flags);
      for (const [agent, v] of Object.entries(flags.rotate ?? {})) if (v === 'handover') out.write(`${ROTATE_WARNING[agent]}\n`);
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
    const { stop, select } = await chooseOrStop(plan, { o, ask, out });
    if (stop !== undefined) return stop;
    // The token goes first: after the registry change nothing would point to a token that failed to delete.
    if (sub === 'remove' && gone.token) {
      try { store(ctx).delete(gone.name); } catch (e) {
        out.write(`${e.message}\nthe account ${gone.name} stays listed: delete the token by hand (service benchkeeper, account ${gone.name}) or fix the credential store, then run benchkeeper accounts remove ${gone.name} again\n`);
        return 1;
      }
      out.write('deleted the stored token\n');
    }
    const code = report(apply(plan, ctx, { scope: 'global', select }), out);
    if (code) return code;
    if (sub === 'remove') {
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

// The changes chosen from a plan, or stop: 0 when there is nothing to change, 1 when none was chosen.
async function chooseOrStop(plan, { o, ask, out }) {
  if (!plan.length) { out.write('nothing to change\n'); return { stop: 0 }; }
  const select = await choose(plan, o, ask, out);
  if (!select.length) { if (o.yes || o.all) plan.forEach((c) => show(c, out)); return { stop: 1 }; }
  return { select };
}

// Installs or removes the usage script, the status line and the hook of an account (Claude Code).
async function trackAccount(ctx, a, { o, out, ask }) {
  const remove = !!o.off;
  const done = () => out.write(remove ? 'removed; the readings already kept stay in the folder\n' : 'tracking starts with the next Claude Code session of this account; usage shows after its first response. A status line in a project\'s settings takes precedence over this one, and then no reading is kept\n');
  if (a.mode === 'host') {
    const plan = preview(trackChanges(a, { remove }));
    const { stop, select } = await chooseOrStop(plan, { o, ask, out });
    if (stop !== undefined) return stop;
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

// The handover to the next account of the pool (opt-in, accounts.mjs rotationFor). after: called by run once the agent exited,
// where it says only what it does and asks only in a terminal. Returns the new session's exit code, 1 when declined, else null.
async function handoverFlow(ctx, a, { dir, yes, ask, out, after = false }) {
  const r = rotationFor(ctx, a, { dir });
  if (r.action !== 'rotate') {
    if (r.action === 'notice') out.write(`notice: account ${a.name} is below a threshold or its usage is partly unknown, and no handover goes to another account (it needs both windows known, one below the minimum and an account of pool ${a.pool ?? '(none)'} at or above its minimum)\n`);
    else if (!after) out.write(r.setting === 'off' ? `rotation is off for ${a.agent}: accounts limits --rotate-${a.agent} handover turns it on\n` : `account ${a.name} is at or above its notice level, or its usage is unknown: no handover\n`);
    return null;
  }
  if (after && !ask.tty) { out.write(`account ${a.name} is below its minimum: benchkeeper accounts handover ${a.name} hands the work to ${r.target.name}\n`); return null; }
  const h = handover(ctx, dir, { from: a, to: r.target });
  out.write(`current account: ${a.name}\ntarget account:  ${r.target.name} (pool ${a.pool})\n\n${h.text}\n${ROTATE_WARNING[a.agent]}\n`);
  for (const k of loginVars(ctx, a.agent)) out.write(`warning: ${k} is set in this environment; the agent uses it instead of the account's login when it reaches the session (only when BENCHKEEPER_PASS_ENV names it)\n`);
  const go = yes || settingsOf(registrySettings(ctx)).continueBelow || (await ask(`Write ${h.path} and start ${a.agent} as ${r.target.name} with it as the first prompt?`));
  // The agent reads the terminal next, and a declined question must not keep the input open.
  ask.close();
  if (!go) { out.write('not started\n'); return 1; }
  writeHandover(h);
  return runAs(ctx, r.target, [a.agent, h.text], { dir, say: (l) => out.write(`${l}\n`), confirmed: true });
}

async function runAccountCommand({ o, positionals, out, ctx, ask }) {
  const args = positionals.slice(1);
  if (!AGENTS.includes(args[0])) { out.write(`run needs the agent after --: ${AGENTS.join(' or ')}\n`); return 2; }
  try {
    const problem = accountsProblem(ctx);
    if (problem) { out.write(`${problem}\n`); return 2; }
    const a = pickAccount(ctx, { name: o.account, agent: args[0] });
    // An account named with --account is never replaced by auto-pick.
    let ran = a;
    const opts = { dir: resolve(o.project ?? '.'), useToken: !!o.token, say: (l) => out.write(`${l}\n`), pick: !o.account, used: (x) => { ran = x; } };
    let code;
    try { code = runAs(ctx, a, args, { ...opts, confirmed: !!o.yes }); } catch (e) {
      if (!(e instanceof NeedsConfirm)) throw e;
      out.write(`${e.message}\n`);
      if (!(await ask('Start anyway?'))) { out.write('not started\n'); return 1; }
      // The agent reads the terminal next: this reader must not keep it.
      ask.close();
      code = runAs(ctx, a, args, { ...opts, confirmed: true });
    }
    // After the session, whatever its exit code: the opt-in handover of the account that ran (nothing is read while it is off).
    return (await handoverFlow(ctx, ran, { dir: opts.dir, yes: false, ask: ask.fresh(), out, after: true })) ?? code;
  } catch (e) {
    out.write(`${e.message}\n`);
    return 1;
  }
}
