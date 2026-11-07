import { type ChildProcessByStdio, spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { join, resolve as absolute, win32 } from "node:path";
import type { Readable, Writable } from "node:stream";
import {
  type Finding,
  type GraphRun,
  type JournalEvent,
  type NodeAttempt,
  type Json,
  JsonValue,
  type Result,
  type RunStatus,
  readDocument,
  WORKFLOW_SCHEMA_VERSION,
  WorkflowDefinition,
} from "@cedarloom/contracts";
import {
  type Attempt,
  type ExecuteOptions,
  type Executors,
  execute,
  OUTPUT_CAP,
  type Prepared,
  startRun,
} from "@cedarloom/engine";
import { type GraphStore, type GraphView, openGraphStore, openGraphView, type RunLease } from "@cedarloom/ledger";
import { cleanEnv } from "@cedarloom/orchestration";
import { stopOrphans, stopTree } from "./orphans.ts";
import { type AgentOptions, agentRun } from "./agent-node.ts";
import { readJson } from "./use-cases.ts";

type Values = Record<string, Json>;

/** How a graph run ended. */
export interface GraphOutcome {
  readonly runId: string;
  readonly status: RunStatus;
}

export interface RunOptions {
  /**
   * The project folder: commands run in it, and files are read below it. A new run takes the current folder when it
   * is absent; a stored run runs in the folder it recorded, which a given one must be.
   */
  readonly project?: string | undefined;
  /** Cancels the run. */
  readonly signal?: AbortSignal | undefined;
  /** Called after each event is committed. */
  readonly onEvent?: ((event: JournalEvent) => void) | undefined;
  /** The POSIX sh for commands; found when absent, null for none. */
  readonly shell?: string | null | undefined;
  /** Waits out a retry's backoff; tests pass one that does not wait. */
  readonly sleep?: ExecuteOptions["sleep"];
  /** What `agent.run` nodes start their workers with; a workflow with one is refused without it. */
  readonly agents?: AgentOptions | undefined;
}

// Stored outputs are blanked after the same 90 days as plan contents, since a command's output can hold a secret.
const OUTPUT_DAYS = 90;

// The node types that run in this version, `agent.run` where agents are set up; writes and approvals come later.
const RUNNABLE = new Set(["trigger.manual", "command.run", "file.read", "condition", "join"]);

/** The POSIX `sh` that runs commands: /bin/sh, or on Windows Git for Windows' sh.exe on PATH or in its usual folder. */
const findShell = (platform: NodeJS.Platform = process.platform, env = process.env): string | null => {
  if (platform !== "win32") return "/bin/sh";
  /* v8 ignore start -- Windows only; the Windows CI leg runs it */
  const git = win32.join(env["ProgramFiles"] ?? "C:\\Program Files", "Git", "bin");
  // Only absolute folders: an empty or relative PATH entry would find a sh.exe in the project.
  const dirs = [...(env["PATH"] ?? "").split(";").filter((dir) => win32.isAbsolute(dir)), git];
  return dirs.map((dir) => win32.join(dir, "sh.exe")).find((file) => existsSync(file)) ?? null;
  /* v8 ignore stop */
};

// The shell waits for a line on stdin before it runs the command: when the runner dies before the attempt's start is
// committed, stdin closes and nothing runs. The command comes in the environment, apart from the values.
const GATE = 'read -r _ || exit 125; eval "$CEDARLOOM_COMMAND"';

// A configuration the validator checked holds its strings; a value of another type comes as its JSON text.
const text = (value: Json | undefined): string => (typeof value === "string" ? value : JSON.stringify(value));

// Values reach a command only as CEDARLOOM_INPUT_<name>, which sh expands after it has parsed the line.
const spawnGated = (
  shell: string,
  project: string,
  { config, inputs }: Attempt,
): ChildProcessByStdio<Writable, Readable, null> => {
  const values = Object.entries(inputs).map(([name, value]) => [`CEDARLOOM_INPUT_${name}`, text(value)]);
  return spawn(shell, ["-c", GATE], {
    cwd: join(project, text(config["cwd"] ?? ".")),
    env: {
      ...cleanEnv(process.env, process.platform),
      ...Object.fromEntries(values),
      CEDARLOOM_COMMAND: text(config["command"]),
    },
    stdio: ["pipe", "pipe", "ignore"],
    detached: process.platform !== "win32",
    windowsHide: true,
  });
};

/** `command.run`: the command's exit code and its standard output, up to just over the cap. */
const command =
  (shell: string, project: string) =>
  (attempt: Attempt): Prepared => {
    const child = spawnGated(shell, project, attempt);
    const { signal } = attempt;
    const chunks: Buffer[] = [];
    let size = 0;
    /* v8 ignore next -- a child that died before its gate opened fails the write; its close says how it ended */
    child.stdin.on("error", () => undefined);
    child.stdout.on("data", (chunk: Buffer) => {
      if (size <= OUTPUT_CAP) chunks.push(chunk);
      size += chunk.length;
    });
    const { promise, resolve } = Promise.withResolvers<number | null>();
    child.once("error", () => resolve(null));
    child.once("close", (code) => resolve(code));
    // On Windows a stopped command's tree can keep its output open (Git for Windows' sh): its shell's exit ends it.
    child.once("exit", (code) => {
      if (signal.aborted) resolve(code);
    });
    const abort = (): void => {
      // A timeout or a cancel ends the command's whole process tree.
      stopTree(Number(child.pid), child);
      // A shell that has exited already, its background child holding the output, ends the attempt now.
      if (child.exitCode === null && child.signalCode === null) return;
      child.stdout.destroy();
      resolve(child.exitCode);
    };
    const closed = promise.finally(() => signal.removeEventListener("abort", abort));
    return {
      pid: child.pid ?? null,
      run: async () => {
        signal.addEventListener("abort", abort, { once: true });
        child.stdin.end(signal.aborted ? "" : "\n");
        const code = await closed;
        return { ok: code === 0, values: { stdout: Buffer.concat(chunks).toString("utf8"), exitCode: code ?? -1 } };
      },
    };
  };

/** `file.read`: the file's text, up to just over the cap. Links are checked with the writes (pending). */
const fileRead =
  (project: string) =>
  ({ config }: Attempt): Prepared => ({
    pid: null,
    run: () => {
      const buffer = Buffer.alloc(OUTPUT_CAP + 1);
      let fd: number | null = null;
      try {
        fd = openSync(join(project, text(config["path"])), "r");
        const read = readSync(fd, buffer, 0, buffer.length, 0);
        return Promise.resolve({ ok: true, values: { content: buffer.subarray(0, read).toString("utf8") } });
      } catch {
        return Promise.resolve({ ok: false });
      } finally {
        if (fd !== null) closeSync(fd);
      }
    },
  });

// What a run needs before it starts: node types this version runs, and sh for commands and a precheck.
const unready = (workflow: WorkflowDefinition, shell: string | null, agents: boolean): Finding | null => {
  const node = workflow.nodes.find((each) => !RUNNABLE.has(each.type) && !(agents && each.type === "agent.run"));
  if (node !== undefined) return { code: "run.node-unsupported", params: { node: node.id, type: node.type } };
  const commands = workflow.nodes.some((each) => each.type === "command.run" || each.with?.["precheck"] !== undefined);
  return commands && shell === null ? { code: "run.shell-missing", params: {} } : null;
};

// Opens the graph runs of `state`, runs `work` with them, and closes them again.
const withGraphs = async <T>(state: string, work: (store: GraphStore) => Promise<Result<T>>): Promise<Result<T>> => {
  const store = openGraphStore(state);
  if (!store.ok) return store;
  try {
    return await work(store.value);
  } finally {
    store.value.close();
  }
};

type Held = Parameters<typeof execute>[2] & { readonly lease: RunLease };

type InProject = RunOptions & { readonly project: string; readonly state: string };

// Runs a run this process holds to its end, then lets go of it.
const runHeld = async (
  store: GraphStore,
  held: Held,
  shell: string,
  options: InProject,
): Promise<Result<GraphOutcome>> => {
  const { lease } = held;
  const { project, state, agents } = options;
  const executors: Executors = {
    "command.run": command(shell, project),
    "file.read": fileRead(project),
    ...(agents === undefined ? {} : { "agent.run": agentRun({ state, runId: lease.runId, project }, agents) }),
  };
  try {
    const { signal, onEvent, sleep } = options;
    const status = await execute(store, lease, held, { executors, signal, onEvent, sleep });
    return status.ok ? { ok: true, value: { runId: lease.runId, status: status.value } } : status;
  } finally {
    lease.release();
  }
};

// Whether a run of the workflow with the inputs can start here: its finding if not, else the shell (or "" for none).
const check = (workflow: WorkflowDefinition, inputs: Values, options: RunOptions): Result<string> => {
  const shell = options.shell === undefined ? findShell() : options.shell;
  const refused = unready(workflow, shell, options.agents !== undefined);
  if (refused !== null) return { ok: false, finding: refused };
  const started = startRun(workflow, inputs);
  return started.ok ? { ok: true, value: shell ?? "" } : started;
};

// Text for a number, boolean or json input, as the CLI gives every input, is read as one; text that does not read
// stays as it is, and the run's input check refuses it.
const typedInputs = (workflow: WorkflowDefinition, inputs: Values): Values => {
  const read = (name: string, value: Json): Json => {
    if (typeof value !== "string" || workflow.inputs?.[name]?.type === "string") return value;
    try {
      const parsed: Json = JSON.parse(value);
      // Text such as 1e400 parses to Infinity, which no JSON value holds: the text stays, and the check refuses it.
      return JsonValue.safeParse(parsed).success ? parsed : value;
    } catch {
      return value;
    }
  };
  return Object.fromEntries(Object.entries(inputs).map(([name, value]) => [name, read(name, value)]));
};

/** Runs a workflow file as a manual run of this process, to its end; inputs not given take their defaults. */
export const runWorkflow = async (
  state: string,
  file: string,
  inputs: Values,
  options: RunOptions,
): Promise<Result<GraphOutcome>> => {
  const read = readJson(file);
  const workflow = read.ok ? readDocument(WorkflowDefinition, WORKFLOW_SCHEMA_VERSION, read.value.json) : read;
  if (!workflow.ok) return workflow;
  const typed = typedInputs(workflow.value, inputs);
  const shell = check(workflow.value, typed, options);
  if (!shell.ok) return shell;
  const project = realFolder(options.project ?? process.cwd());
  if (!project.ok) return project;
  return withGraphs(state, (store) => {
    store.prune(OUTPUT_DAYS);
    const definition = workflow.value;
    const run = {
      definition,
      inputs: typed,
      trigger: "manual",
      mode: "act",
      parentRun: null,
      parentNode: null,
      project: project.value,
    } as const;
    const held = { lease: store.create(run), workflow: definition, inputs: typed, journal: [] };
    return runHeld(store, held, shell.value, { ...options, project: project.value, state });
  });
};

// A folder's real path; a path that is no folder is refused, since each command there would fail.
const realFolder = (path: string): Result<string> => {
  try {
    const real = realpathSync.native(path);
    if (statSync(real).isDirectory()) return { ok: true, value: real };
  } catch {
    // Not there.
  }
  return { ok: false, finding: { code: "run.project-missing", params: { project: absolute(path) } } };
};

// The folder a stored run's commands run in: the one it recorded, which must still be there, and which a given folder
// must be (one that is not there by its path as given).
const projectOf = (run: GraphRun, given: string | undefined): Result<string> => {
  const path = given ?? run.project;
  const real = realFolder(path);
  const named = real.ok ? real.value : absolute(path);
  if (named === run.project) return real;
  const params = { runId: run.id, project: run.project, given: named };
  return { ok: false, finding: { code: "run.project-mismatch", params } };
};

type TakenOver = { readonly run: GraphRun; readonly lease: RunLease };
// Runs a run this process took over on from its journal; one whose journal it cannot trust it lets go of again.
const runOn = (store: GraphStore, { run, lease }: TakenOver, shell: string, options: InProject) => {
  const journal = store.events(run.id);
  if (!journal.ok) {
    lease.release();
    return Promise.resolve(journal);
  }
  // The processes of the attempts left running end before they count as interrupted and any rerun starts.
  stopOrphans(store.attempts(run.id));
  const held = { lease, workflow: run.definition, inputs: run.inputs, journal: journal.value };
  return runHeld(store, held, shell, options);
};

/**
 * Takes over a run no process holds and runs it on from its journal: attempts left started end interrupted and count
 * as failed (Q4). Refused when the version here does not run it, with the validator's finding when it changed.
 */
export const resumeRun = (state: string, runId: string, options: RunOptions): Promise<Result<GraphOutcome>> =>
  withGraphs(state, async (store) => {
    const run = store.graphRun(runId);
    if (run === undefined) return { ok: false, finding: { code: "run.not-found", params: { runId } } };
    const shell = check(run.definition, run.inputs, options);
    if (!shell.ok) return shell;
    const project = projectOf(run, options.project);
    if (!project.ok) return project;
    const lease = store.takeOver(runId);
    return lease.ok
      ? runOn(store, { run, lease: lease.value }, shell.value, { ...options, project: project.value, state })
      : lease;
  });

// Opens the graph runs of `state` for reading, runs `read` with them (null while there are none), and closes them.
const withGraphView = <T>(state: string, read: (view: GraphView | null) => Result<T>): Result<T> => {
  const view = openGraphView(state);
  if (!view.ok) return view;
  try {
    return read(view.value);
  } finally {
    view.value?.close();
  }
};

/** The graph runs, newest first. Reads never write: no lock, no migration. */
export const listGraphRuns = (state: string): Result<GraphRun[]> =>
  withGraphView(state, (view) => ({ ok: true, value: view?.graphRuns() ?? [] }));

/** A graph run with its attempts; the pid of an attempt that ended interrupted is what a user checks by hand. */
export const showGraphRun = (state: string, runId: string): Result<{ run: GraphRun; attempts: NodeAttempt[] }> =>
  withGraphView(state, (view) => {
    const run = view?.graphRun(runId);
    if (view === null || run === undefined) return { ok: false, finding: { code: "run.not-found", params: { runId } } };
    return { ok: true, value: { run, attempts: view.attempts(runId) } };
  });

/**
 * What a resume or cancel of a graph run would do, read without a write: the run, the folder its commands run in (or
 * why not), and the attempts left running, which end interrupted once their processes are stopped.
 */
export const planGraphRun = (
  state: string,
  runId: string,
  { verb, project }: { readonly verb: "resume" | "cancel"; readonly project?: string | undefined },
): Result<{ run: GraphRun; project: string | null; attempts: NodeAttempt[] }> => {
  const shown = showGraphRun(state, runId);
  if (!shown.ok) return shown;
  const { run, attempts } = shown.value;
  const folder = projectOf(run, project);
  const refused = refusalOf(run, verb, folder);
  if (refused !== null) return { ok: false, finding: refused };
  const running = attempts.filter((attempt) => attempt.state === "running");
  return { ok: true, value: { run, project: folder.ok ? folder.value : null, attempts: running } };
};

// The finding a resume or cancel with --yes would give: an ended run, a resume of a run its runner still holds, a folder
// that is another one, or for a resume one that is not there (a cancel starts nothing).
const refusalOf = (run: GraphRun, verb: "resume" | "cancel", folder: Result<string>): Finding | null => {
  const { id: runId, status, pid } = run;
  if (!ACTIVE.has(status)) return { code: "run.finished", params: { runId, status } };
  if (verb === "resume" && status !== "interrupted") return { code: "run.lease-held", params: { runId, pid } };
  const missing = !folder.ok && folder.finding.code === "run.project-missing";
  return folder.ok || (missing && verb === "cancel") ? null : folder.finding;
};
const ACTIVE = new Set(["running", "waiting", "interrupted"]);

const signaled = (pid: number): boolean => {
  try {
    return process.kill(pid, "SIGTERM");
  } catch {
    return false;
  }
};

/**
 * Cancels a graph run. A run another process runs gets SIGTERM, which its runner turns into a cancel (on Windows the
 * signal ends the runner, and the next cancel ends the run); a run no process holds is taken over and ends cancelled.
 */
export const cancelRun = (
  state: string,
  runId: string,
  options: RunOptions,
): Promise<Result<{ runId: string; status: RunStatus | "cancelling" }>> =>
  withGraphs<{ runId: string; status: RunStatus | "cancelling" }>(state, async (store) => {
    const run = store.graphRun(runId);
    if (run === undefined) return { ok: false, finding: { code: "run.not-found", params: { runId } } };
    // A cancel starts nothing, so a folder that is gone does not stop it; another folder named does.
    const project = projectOf(run, options.project);
    if (!project.ok && project.finding.code === "run.project-mismatch") return project;
    let lease = store.takeOver(runId);
    if (!lease.ok && lease.finding.code === "run.lease-held") {
      if (signaled(lease.finding.params.pid)) return { ok: true, value: { runId, status: "cancelling" } };
      // The runner has ended since its lease was seen: the run is taken over after all.
      lease = store.takeOver(runId);
    }
    if (!lease.ok) return lease;
    // A cancelled run starts nothing, so it needs no shell.
    store.append(runId, lease.value.epoch, { type: "cancel" });
    return runOn(store, { run, lease: lease.value }, "", {
      ...options,
      project: project.ok ? project.value : "",
      state,
    });
  });
