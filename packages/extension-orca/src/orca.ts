import { resolve } from "node:path";
import {
  type ActionContext,
  allowed,
  type DoctorFinding,
  jsonAnswer,
  olderRelease,
  programVersion,
  shellWord,
  valueAt as at,
  type WorkerHandlers,
  type WorkerStart,
  type WorkerStartParams,
} from "@cedarloom/extension-sdk";

/** The Orca version this extension and its recorded test outputs were checked with; another major is a warning. */
export const OBSERVED = "1.4.251";
// Well below the doctor's limit for all three calls: Orca's own status call gives up after 1 s.
const MS = 2500;
// Where the manifest names Orca's CLI. On Windows it is an orca.cmd, which only cmd.exe runs, and the host starts no
// shell (CVE-2024-27980).
const CHECKED = new Set(["darwin", "linux"]);

type Exec = Pick<ActionContext, "exec">;
type Probe = { installed: false; reason: string } | { installed: true; version: string; running: boolean };

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// Orca's JSON answer to a command, its `result`; an answer that is not `ok` throws with Orca's message.
const orca = async ({ exec }: Exec, args: string[], timeoutMs: number): Promise<unknown> => {
  const command = `orca ${args.slice(0, 2).join(" ")}`;
  const ran = await exec({ program: "orca", args: [...args, "--json"], timeoutMs });
  const answer = jsonAnswer(command, ran);
  if (at(answer, "ok") !== true) throw new Error(`${command}: ${String(at(answer, "error", "message"))}`);
  if (ran.code !== 0) throw new Error(`${command} exited with ${ran.code}`);
  return at(answer, "result");
};
const majorOf = (version: string): string | undefined => /^v?(\d+)\.\d+/.exec(version)?.[1];

/**
 * Orca through its documented CLI, which the host finds (on Linux `orca-ide` or its shim, never a bare `orca`, which
 * there can be the GNOME screen reader): its version, and whether its app runs and its runtime answers.
 */
const probe = async ({ exec }: Exec): Promise<Probe> => {
  const version = await programVersion(exec, "orca", MS);
  if (!version.installed) return version;
  // It answers also when no app runs.
  const answer = await orca({ exec }, ["status"], MS);
  const running = at(answer, "app", "running") === true && at(answer, "runtime", "reachable") === true;
  return { installed: true, version: version.version, running };
};

// Orca's skills a Claude Code session of an Orca worker needs; Orca installs them, CedarLoom never does.
const SKILLS = ["orca-cli", "orchestration"];

// Which of them Claude Code lacks, by the list of Orca's running app (its CLI asks the app).
const missingSkills = async (context: Exec): Promise<string[]> => {
  const skills: unknown = at(await orca(context, ["skills", "installed"], MS), "skills");
  if (!Array.isArray(skills)) throw new Error("orca skills installed --json lists no skills");
  const forClaude = skills.filter((skill) => [at(skill, "providers")].flat().includes("claude"));
  return SKILLS.filter((name) => !forClaude.some((skill) => at(skill, "name") === name));
};

const finding = (severity: DoctorFinding["severity"], code: string, message: string): DoctorFinding => ({
  check: "orca",
  severity,
  code,
  message,
});

// A warning for a major version not checked with or a version that does not read.
const versionWarnings = (version: string): DoctorFinding[] => {
  const major = majorOf(version);
  if (major === undefined) return [finding("warning", "orca.unreadable", `Orca's version ${version} does not read.`)];
  if (major === majorOf(OBSERVED)) return [];
  const unobserved = `Orca ${version} is a major version this CedarLoom was not checked with (${OBSERVED}).`;
  return [finding("warning", "orca.unobserved-major", unobserved)];
};

// While Orca runs: the command that installs the skills Claude Code lacks.
const skillFindings = async (context: Exec): Promise<DoctorFinding[]> => {
  let missing: string[];
  try {
    missing = await missingSkills(context);
  } catch (error) {
    const unread = `Orca's skills did not list as expected: ${messageOf(error)}`;
    return [finding("warning", "orca.skills-unreadable", unread)];
  }
  if (missing.length === 0) return [];
  const command = ["orca skills install", ...missing.map((name) => `--skill ${name}`)].join(" ");
  return [finding("info", "orca.skills-missing", `Claude Code lacks Orca's ${missing.join(", ")}: run ${command}.`)];
};

// The first Orca whose CLI selects a saved Claude account (stablyai/orca#38944).
const SELECTS = "1.4.252";
// Orca's account calls; a cold `orca account list` refreshes usage that is out of date (about 2 s here).
const ACCOUNT_MS = 5000;

/**
 * Orca's Claude accounts: the saved one new panes launch with (none: the System default, the default home's own login,
 * which follows claude-swap's switches) and the saved one signed in as the default home, matched by email and
 * organization inside this process, so no email leaves it (switching plan 3).
 */
type ClaudeAccounts = { selected: string | null; home: string | null };

const claudeAccountsOf = async (context: Exec): Promise<ClaudeAccounts> => {
  const claude = at(await orca(context, ["account", "list"], ACCOUNT_MS), "claude");
  const accounts: unknown = at(claude, "accounts");
  if (!Array.isArray(accounts)) throw new Error("orca account list named no Claude accounts");
  const [email, organization] = [at(claude, "systemDefaultEmail"), at(claude, "systemDefaultOrganizationUuid")];
  const homes = accounts.filter(
    (each) =>
      typeof email === "string" &&
      String(at(each, "email")).toLowerCase() === email.toLowerCase() &&
      at(each, "organizationUuid") === organization,
  );
  const [selected, home] = [selectedOf(claude), homes.length === 1 ? at(homes[0], "id") : null];
  return { selected, home: typeof home === "string" ? home : null };
};
// The saved Claude account new panes on this host launch with, as Orca's account state names it.
const selectedOf = (claude: unknown): string | null => {
  const selected = at(claude, "activeAccountIdsByRuntime", "host") ?? at(claude, "activeAccountId");
  return typeof selected === "string" ? selected : null;
};

const SYSTEM = "system default";
const modeOf = ({ selected, home }: ClaudeAccounts): string => {
  if (selected === null) return SYSTEM;
  return selected === home ? "managed, the default home's account" : "managed, another account";
};
const FOLLOWS =
  "System default in Orca's Settings, AI Provider Accounts, follows claude-swap's auto mode without CedarLoom";

// While Orca runs: how its Claude panes pick their account; a warning when claude-swap's switches cannot reach them.
const accountFindings = async (context: Exec): Promise<DoctorFinding[]> => {
  let accounts: ClaudeAccounts;
  try {
    accounts = await claudeAccountsOf(context);
  } catch (error) {
    return [
      finding("warning", "orca.accounts-unreadable", `Orca's accounts did not list as expected: ${messageOf(error)}`),
    ];
  }
  if (accounts.selected === null) {
    return [
      finding(
        "info",
        "orca.accounts-system",
        "Orca's Claude panes use the System default, the default home's account, so they follow claude-swap's switches.",
      ),
    ];
  }
  if (accounts.selected === accounts.home) {
    const later = `Orca's Claude panes use the saved account signed in as the default home; claude-swap's own later switches reach them only through cedarloom orca follow. ${FOLLOWS}.`;
    return [finding("info", "orca.accounts-managed", later)];
  }
  const other = `Orca's Claude panes use a saved account other than the default home's, so claude-swap's switches do not reach them: run cedarloom orca follow. ${FOLLOWS}.`;
  return [finding("warning", "orca.accounts-elsewhere", other)];
};

/**
 * The doctor's check: whether Orca is installed and running, a warning for a major version not checked with or a
 * version it cannot read, and while it runs, the command for the Orca skills Claude Code lacks and how its Claude panes
 * pick their account.
 */
export const doctor = async (context: Exec, platform: string = process.platform): Promise<DoctorFinding[]> => {
  if (!CHECKED.has(platform)) return [finding("info", "orca.unchecked", "Orca is not checked on this platform yet.")];
  let found: Probe;
  try {
    found = await probe(context);
  } catch (error) {
    return [finding("warning", "orca.unreadable", `Orca did not answer as expected: ${messageOf(error)}`)];
  }
  if (!found.installed) return [finding("info", "orca.missing", `Orca is not installed here (${found.reason}).`)];
  const state = found.running
    ? finding("info", "orca.running", `Orca ${found.version} is running.`)
    : finding("info", "orca.not-running", `Orca ${found.version} is installed and not running.`);
  const running = found.running ? [...(await skillFindings(context)), ...(await accountFindings(context))] : [];
  return [state, ...versionWarnings(found.version), ...running];
};

/**
 * The status action: whether Orca is installed, its version, whether it is running, and while it runs, how its Claude
 * panes pick their account.
 */
export const status = async (context: Exec): Promise<Record<string, unknown>> => {
  const found = await probe(context);
  if (!found.installed) return { installed: false, running: false };
  return found.running ? { ...found, claudeAccounts: modeOf(await claudeAccountsOf(context)) } : { ...found };
};

/**
 * Orca's managed Claude account follows the default home's, which claude-swap switches (owner, Q4): the saved account
 * signed in as the default home is selected for new panes, once the user names orca with --allow. On the System
 * default, panes follow already.
 */
export const follow = async ({
  exec,
  config,
}: Pick<ActionContext, "exec" | "config">): Promise<Record<string, unknown>> => {
  const found = await probe({ exec });
  if (!found.installed || !found.running) return { followed: false, hint: "Orca is not running" };
  const accounts = await claudeAccountsOf({ exec });
  const mode = modeOf(accounts);
  if (accounts.selected === null || accounts.selected === accounts.home) return { mode, followed: true };
  if (accounts.home === null) {
    const hint = `no saved Orca account signs in as the default home's account: add it in Orca, or ${FOLLOWS}`;
    return { mode, followed: false, hint };
  }
  if (olderRelease(found.version, SELECTS) !== false) {
    return {
      mode,
      followed: false,
      hint: `managed mode cannot follow before Orca ${SELECTS}: update Orca, or ${FOLLOWS}`,
    };
  }
  const args = ["account", "select", "--agent", "claude", "--account", accounts.home];
  if (!allowed(config, "orca"))
    return { mode, followed: false, runs: `orca ${args.join(" ")}`, approve: "cedarloom orca follow --allow orca" };
  if (selectedOf(await orca({ exec }, args, ACCOUNT_MS)) !== accounts.home)
    throw new Error(`orca ${args.join(" ")} left another account selected`);
  return { mode: modeOf({ ...accounts, selected: accounts.home }), followed: true };
};

// A start's eight Orca calls, two waits and, after a failure, two closes stay below the host's 130 s (worst case 120 s).
const ORCA_MS = 5000;
const START_MS = 30_000;

/**
 * The worktree by its id, which every later call names, so all reach the folder checked; and whether Orca made it (it
 * is no repository's main checkout) from the repository the host names.
 */
const worktreeOf = async (context: Exec, selector: string, repository: string) => {
  const shown = at(await orca(context, ["worktree", "show", `--worktree=${selector}`], ORCA_MS), "worktree");
  const [id, repoId] = [at(shown, "id"), at(shown, "repoId")];
  if (typeof id !== "string") throw new Error("orca worktree show named no worktree");
  const worktree = `id:${id}`;
  if (at(shown, "isMainWorktree") !== false || typeof repoId !== "string") return { worktree, trusted: false };
  const path = at(await orca(context, ["repo", "show", `--repo=id:${repoId}`], ORCA_MS), "repo", "path");
  return { worktree, trusted: typeof path === "string" && resolve(path) === resolve(repository) };
};

const terminalOf = async (context: Exec, worktree: string, title: string, command?: string): Promise<string> => {
  // Values as --name=value: Orca's parser reads a value that starts with -- as a flag.
  const run = command === undefined ? [] : [`--command=${command}`];
  const created = await orca(
    context,
    ["terminal", "create", `--worktree=${worktree}`, `--title=${title}`, ...run],
    ORCA_MS,
  );
  const handle = at(created, "terminal", "handle");
  if (typeof handle !== "string") throw new Error("orca terminal create named no terminal");
  return handle;
};

// The trust prompt as the live test saw it: "No, exit" selected, "Yes, I trust this folder" next, so Down then Enter.
const promptAsSeen = async (context: Exec, terminal: string): Promise<boolean> => {
  const tail = at(await orca(context, ["terminal", "read", "--terminal", terminal], ORCA_MS), "terminal", "tail");
  const lines = Array.isArray(tail) ? tail.map((line) => String(line).trim()) : [];
  const no = lines.indexOf("\u276f No, exit");
  return no !== -1 && lines[no + 1] === "Yes, I trust this folder";
};

// Claude Code's folder-trust prompt is answered only in a worktree Orca made from the host's repository (owner, SM6).
const settled = async (context: Exec, terminal: string, trusted: boolean): Promise<void> => {
  const wait = ["terminal", "wait", "--terminal", terminal, "--for", "tui-idle", "--timeout-ms", String(START_MS)];
  for (const answered of [false, true]) {
    const waited = at(await orca(context, wait, START_MS + ORCA_MS), "wait");
    if (at(waited, "satisfied") === true) return;
    const blocked = at(waited, "blockedReason");
    if (blocked !== "agent-trust-workspace" || !trusted || answered || !(await promptAsSeen(context, terminal))) {
      throw new Error(`the agent did not get ready: ${String(blocked ?? at(waited, "status"))}`);
    }
    await orca(context, ["terminal", "send", "--terminal", terminal, "--text", "\u001b[B"], ORCA_MS);
    await orca(context, ["terminal", "send", "--terminal", terminal, "--text", "\r"], ORCA_MS);
  }
};

// One close after another, as host/exec runs few programs at once; the terminals that did not close.
const release = async (context: Exec, handles: string[]): Promise<string[]> => {
  const open: string[] = [];
  for (const handle of handles) {
    const closed = orca(context, ["terminal", "close", "--terminal", handle], ORCA_MS);
    if (
      !(await closed.then(
        () => true,
        () => false,
      ))
    )
      open.push(handle);
  }
  return open;
};

/** Starts a supervised Orca worker: a terminal in the worktree runs the host's launch line, then gets the spec. */
export const startWorker = async (
  context: Exec,
  { worktree: selector, line, spec, title, repository }: Omit<WorkerStartParams, "runner">,
  platform: string = process.platform,
): Promise<WorkerStart> => {
  if (!CHECKED.has(platform)) throw new Error("Orca workers are not started on this platform yet");
  const { worktree, trusted } = await worktreeOf(context, selector, repository);
  // worker-start refuses a caller with no Orca terminal of its own (live test, 2026-11-07): a plain shell sends it.
  const sender = await terminalOf(context, worktree, `${title} (CedarLoom)`);
  const handles = [sender];
  try {
    const agent = await terminalOf(context, worktree, title, line.map((word) => shellWord(word)).join(" "));
    handles.unshift(agent);
    await settled(context, agent, trusted);
    const start = ["orchestration", "worker-start", "--from", sender, "--terminal", agent, `--worktree=${worktree}`];
    const started = await orca(context, [...start, `--spec=${spec}`, `--task-title=${title}`], ORCA_MS);
    const dispatch = at(started, "dispatchId");
    if (typeof dispatch !== "string") throw new Error("orca worker-start named no dispatch");
    return { dispatch, handles };
  } catch (error) {
    const open = await release(context, handles);
    if (open.length === 0) throw error;
    throw new Error(`${messageOf(error)}; terminals left open: ${open.join(", ")}`, { cause: error });
  }
};

/** The worker runner `claude`: Orca workers of Claude Code on the host's launch lines. */
export const workers: WorkerHandlers = {
  "worker/start": (params, context) => startWorker(context, params),
  "worker/show": async ({ dispatch }, context) => {
    const shown = await orca(context, ["orchestration", "worker-show", "--dispatch", dispatch], ORCA_MS);
    const state = at(shown, "state");
    if (typeof state !== "string") throw new Error("orca worker-show named no state");
    return { state, settled: at(shown, "stage") === "settled" };
  },
  "worker/release": async ({ handles }, context) => ({ released: (await release(context, handles)).length === 0 }),
};
