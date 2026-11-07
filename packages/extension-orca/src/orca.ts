import {
  type ActionContext,
  type DoctorFinding,
  programVersion,
  valueAt as at,
  type WorkerHandlers,
  type WorkerStart,
  type WorkerStartParams,
} from "@cedarloom/extension-sdk";

/** The Orca version this extension and its recorded test outputs were checked with; another major is a warning. */
export const OBSERVED = "1.4.251";
// Well below the doctor's 10 s for all three calls: Orca's own status call gives up after 1 s.
const MS = 2500;
// Where the manifest names Orca's CLI. On Windows it is an orca.cmd, which only cmd.exe runs, and the host starts no
// shell (CVE-2024-27980).
const CHECKED = new Set(["darwin", "linux"]);

type Exec = Pick<ActionContext, "exec">;
type Probe = { installed: false; reason: string } | { installed: true; version: string; running: boolean };

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const majorOf = (version: string): string | undefined => /^v?(\d+)\.\d+/.exec(version)?.[1];

/**
 * Orca through its documented CLI, which the host finds (on Linux `orca-ide` or its shim, never a bare `orca`, which
 * there can be the GNOME screen reader): its version, and whether its app runs and its runtime answers.
 */
const probe = async ({ exec }: Exec): Promise<Probe> => {
  const version = await programVersion(exec, "orca", MS);
  if (!version.installed) return version;
  const status = await exec({ program: "orca", args: ["status", "--json"], timeoutMs: MS });
  // It exits 0 also when no app runs: another code is an error.
  if (status.code !== 0) throw new Error(`orca status --json exited with ${status.code}`);
  const answer: unknown = JSON.parse(status.stdout);
  const running =
    at(answer, "result", "app", "running") === true && at(answer, "result", "runtime", "reachable") === true;
  return { installed: true, version: version.version, running };
};

// Orca's skills a Claude Code session of an Orca worker needs; Orca installs them, CedarLoom never does.
const SKILLS = ["orca-cli", "orchestration"];

// Which of them Claude Code lacks, by the list of Orca's running app (its CLI asks the app).
const missingSkills = async ({ exec }: Exec): Promise<string[]> => {
  const listed = await exec({ program: "orca", args: ["skills", "installed", "--json"], timeoutMs: MS });
  if (listed.code !== 0) throw new Error(`orca skills installed --json exited with ${listed.code}`);
  const skills: unknown = at(JSON.parse(listed.stdout), "result", "skills");
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

/**
 * The doctor's check: whether Orca is installed and running, a warning for a major version not checked with or a
 * version it cannot read, and while it runs, the command for the Orca skills Claude Code lacks.
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
  const skills = found.running ? await skillFindings(context) : [];
  return [state, ...versionWarnings(found.version), ...skills];
};

/** The status action: whether Orca is installed, its version, and whether it is running. */
export const status = async (context: Exec): Promise<Record<string, unknown>> => {
  const found = await probe(context);
  return found.installed ? { ...found } : { installed: false, running: false };
};

// Orca answers its CLI locally; an agent's terminal gets up to 45 s to start, twice when its trust prompt is answered,
// so a start stays within the host's limit for a worker runner's call.
const ORCA_MS = 10_000;
const START_MS = 45_000;

// Orca's JSON answer to a command, its `result`; an answer that is not `ok` throws with Orca's message.
const orca = async ({ exec }: Exec, args: string[], timeoutMs = ORCA_MS): Promise<unknown> => {
  const { code, stdout } = await exec({ program: "orca", args: [...args, "--json"], timeoutMs });
  const answer: unknown = JSON.parse(stdout);
  if (at(answer, "ok") !== true)
    throw new Error(`orca ${args[0]} ${args[1]}: ${String(at(answer, "error", "message"))}`);
  if (code !== 0) throw new Error(`orca ${args[0]} ${args[1]} exited with ${code}`);
  return at(answer, "result");
};

// A launch line as the terminal's POSIX shell reads it: each argument in single quotes.
const shellLine = (line: string[]): string => line.map((arg) => `'${arg.replaceAll("'", "'\\''")}'`).join(" ");

// Whether Orca made the worktree (it is no repository's main checkout) from the repository the host names.
const fromRepository = async (context: Exec, worktree: string, repository: string): Promise<boolean> => {
  const shown = at(await orca(context, ["worktree", "show", "--worktree", worktree]), "worktree");
  if (at(shown, "isMainWorktree") !== false) return false;
  const repo = await orca(context, ["repo", "show", "--repo", `id:${String(at(shown, "repoId"))}`]);
  return at(repo, "repo", "path") === repository;
};

const terminalOf = async (context: Exec, worktree: string, title: string, command?: string): Promise<string> => {
  const run = command === undefined ? [] : ["--command", command];
  const created = await orca(context, ["terminal", "create", "--worktree", worktree, "--title", title, ...run]);
  const handle = at(created, "terminal", "handle");
  if (typeof handle !== "string") throw new Error("orca terminal create named no terminal");
  return handle;
};

/**
 * Waits for the agent's screen to settle. Claude Code's folder-trust prompt (Orca's `agent-trust-workspace`) is
 * answered "Yes, I trust this folder" only for a worktree Orca made from the host's repository (owner, SM6).
 */
const settled = async (context: Exec, terminal: string, trusted: boolean): Promise<void> => {
  const wait = ["terminal", "wait", "--terminal", terminal, "--for", "tui-idle", "--timeout-ms", String(START_MS)];
  for (const answered of [false, true]) {
    const waited = at(await orca(context, wait, START_MS + ORCA_MS), "wait");
    if (at(waited, "satisfied") === true) return;
    const blocked = at(waited, "blockedReason");
    if (blocked !== "agent-trust-workspace" || !trusted || answered) {
      throw new Error(`the agent did not get ready: ${String(blocked ?? at(waited, "status"))}`);
    }
    // The prompt opens on "No, exit": down to "Yes, I trust this folder", then Enter.
    await orca(context, ["terminal", "send", "--terminal", terminal, "--text", "\u001b[B"]);
    await orca(context, ["terminal", "send", "--terminal", terminal, "--text", "\r"]);
  }
};

// Closes the terminals; one already gone counts as closed.
const release = async (context: Exec, handles: string[]): Promise<boolean> => {
  const closed = handles.map((handle) => orca(context, ["terminal", "close", "--terminal", handle]).then(() => true));
  return (await Promise.all(closed.map((each) => each.catch(() => false)))).every(Boolean);
};

/**
 * Starts a supervised Orca worker on the host's launch line: a terminal in the worktree runs the line, and once its
 * agent is ready Orca's worker-start gives it the spec. CedarLoom has no Orca terminal of its own, which worker-start
 * needs (live test, 2026-11-07): a plain shell beside it sends the start, and its mailbox gets the worker's reports.
 */
export const startWorker = async (
  context: Exec,
  { worktree, line, spec, title, repository }: Omit<WorkerStartParams, "runner">,
  platform: string = process.platform,
): Promise<WorkerStart> => {
  if (!CHECKED.has(platform)) throw new Error("Orca workers are not started on this platform yet");
  const trusted = await fromRepository(context, worktree, repository);
  const sender = await terminalOf(context, worktree, `${title} (CedarLoom)`);
  const handles = [sender];
  try {
    const agent = await terminalOf(context, worktree, title, shellLine(line));
    handles.unshift(agent);
    await settled(context, agent, trusted);
    const start = ["orchestration", "worker-start", "--from", sender, "--terminal", agent, "--worktree", worktree];
    const started = await orca(context, [...start, "--spec", spec, "--task-title", title]);
    const dispatch = at(started, "dispatchId");
    if (typeof dispatch !== "string") throw new Error("orca worker-start named no dispatch");
    return { dispatch, handles };
  } catch (error) {
    await release(context, handles);
    throw error;
  }
};

/** The worker runner `claude`: Orca workers of Claude Code on the host's launch lines. */
export const workers: WorkerHandlers = {
  "worker/start": (params, context) => startWorker(context, params),
  "worker/show": async ({ dispatch }, context) => {
    const shown = await orca(context, ["orchestration", "worker-show", "--dispatch", dispatch]);
    const state = at(shown, "state");
    if (typeof state !== "string") throw new Error("orca worker-show named no state");
    return { state, settled: at(shown, "stage") === "settled" };
  },
  "worker/release": async ({ handles }, context) => ({ released: await release(context, handles) }),
};
