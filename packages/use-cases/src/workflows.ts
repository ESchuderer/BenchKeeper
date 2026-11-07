import { type ChildProcessByStdio, spawn } from "node:child_process";
import { closeSync, constants, existsSync, lstatSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve as absolute, sep, win32 } from "node:path";
import type { Readable, Writable } from "node:stream";
import {
  type Finding,
  type GatePoint,
  type GraphRun,
  type JournalEvent,
  type NodeAttempt,
  type Json,
  JsonValue,
  PLAN_SCHEMA_VERSION,
  type Plan,
  type Result,
  RunEvent,
  type RunState,
  type RunStatus,
  readDocument,
  WORKFLOW_SCHEMA_VERSION,
  WorkflowDefinition,
} from "@cedarloom/contracts";
import {
  type Attempt,
  apply,
  type ExecuteOptions,
  type Executors,
  errorCode,
  execute,
  hashFile,
  OUTPUT_CAP,
  type Prepared,
  type Recovery,
  replay,
  reportOnly,
  startRun,
} from "@cedarloom/engine";
import {
  type GraphStore,
  type GraphView,
  openGraphStore,
  openGraphView,
  planHash,
  type RunLease,
} from "@cedarloom/ledger";
import { cleanEnv } from "@cedarloom/orchestration";
import { stopTree } from "@cedarloom/extension-host";
import { stopOrphans } from "./orphans.ts";
import { type AgentOptions, agentRecover, agentRun } from "./agent-node.ts";
import { readJson, retryBusy, withStore, withView } from "./use-cases.ts";

type Values = Record<string, Json>;

/** How a graph run ended, or that it waits for the owner without a runner. */
export interface GraphOutcome {
  readonly runId: string;
  readonly status: RunStatus | "waiting";
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
  /** A new run only reports (A28): it writes nothing but its record. A stored run keeps the mode it started with. */
  readonly report?: boolean | undefined;
}

// Stored outputs are blanked after 90 days, since a command's output can hold a secret.
const OUTPUT_DAYS = 90;

// The node types that run in this version, `agent.run` where agents are set up.
const RUNNABLE = new Set([
  "trigger.manual",
  "command.run",
  "file.read",
  "file.write",
  "condition",
  "join",
  "human.approval",
]);

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

// The file a node names, below the real path of its nearest folder that is there (a write makes the ones missing); null
// when that folder is outside the project's real path, as through a link (review of #1076). A link counts as there,
// also a dangling one, whose real path then throws. `project` is a real path.
const inProject = (project: string, path: string): string | null => {
  const full = join(project, path);
  let folder = dirname(full);
  while (lstatSync(folder, { throwIfNoEntry: false }) === undefined) folder = dirname(folder);
  const real = realpathSync.native(folder);
  const below = relative(project, real);
  return below.split(sep)[0] === ".." || isAbsolute(below) ? null : join(real, relative(folder, full));
};
const OUTSIDE = { ok: false, values: { error: "file.outside-project" } } as const;

/** `file.read`: the file's text, up to just over the cap; neither its folder nor the file itself may be a way out. */
const fileRead =
  (project: string) =>
  ({ config }: Attempt): Prepared => ({
    pid: null,
    run: () => {
      const buffer = Buffer.alloc(OUTPUT_CAP + 1);
      let fd: number | null = null;
      try {
        const path = inProject(project, text(config["path"]));
        if (path === null) return Promise.resolve(OUTSIDE);
        fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        const read = readSync(fd, buffer, 0, buffer.length, 0);
        return Promise.resolve({ ok: true, values: { content: buffer.subarray(0, read).toString("utf8") } });
      } catch {
        return Promise.resolve({ ok: false });
      } finally {
        if (fd !== null) closeSync(fd);
      }
    },
  });

// The plan of a `file.write`: the node's content (text as it is, any other value as its JSON) at its path, replacing
// what is there now.
const planOf = (project: string, { config, data }: Pick<Attempt, "config" | "data">): Plan | string => {
  let path: string | null;
  try {
    path = inProject(project, text(config["path"]));
  } catch (error) {
    return errorCode(error);
  }
  if (path === null) return OUTSIDE.values.error;
  const content = data["content"] === undefined ? "" : text(data["content"]);
  return { schemaVersion: PLAN_SCHEMA_VERSION, operations: [{ kind: "write", path, before: hashFile(path), content }] };
};

/**
 * `file.write`: a plan that waits at its gate for the owner's approval of its hash, then an apply run of the run store,
 * which backs it up for undo, recorded on the attempt before it writes anything.
 */
const fileWrite =
  (project: string, state: string) =>
  (attempt: Attempt): Prepared => {
    const plan = planOf(project, attempt);
    if (typeof plan === "string")
      return { pid: null, run: () => Promise.resolve({ ok: false, values: { error: plan } }) };
    const hash = planHash(plan);
    // A stopped attempt, or one whose run another runner took over, writes nothing.
    const onBegun = (applyRun: string): void => {
      if (attempt.signal.aborted || !attempt.applying(applyRun)) throw new Error("the attempt may not write");
    };
    return {
      pid: null,
      planHash: hash,
      run: async () => {
        const applied = await retryBusy(() =>
          withStore(state, (store) => ({ ok: true, value: apply(store, plan, hash, { onBegun, realPaths: true }) })),
        );
        const code = applied.ok ? applied.value.findings[0]?.code : applied.finding.code;
        return code === undefined ? { ok: true } : { ok: false, values: { error: code } };
      },
    };
  };

/**
 * The recovery of `file.write` attempts a dead runner left (plan section 3): done when the apply run it began has
 * applied, which opening the run store settles, else interrupted (Q4), so a retry plans again and nothing applies twice.
 */
const writeRecover =
  (state: string): Recovery =>
  ({ applyRun }) => {
    if (applyRun === null) return null;
    // `applied` is final once committed, so a view reads it without the store lock an apply holds for its length.
    const runs = withView(state, (view) => ({ ok: true, value: view?.runs() ?? [] }));
    const applied = runs.ok && runs.value.some((each) => each.id === applyRun && each.status === "applied");
    return applied ? { pid: null, run: () => Promise.resolve({ ok: true }) } : null;
  };

// What a run needs before it starts: node types this version runs, and sh for commands and a precheck.
const unready = (workflow: WorkflowDefinition, shell: string | null, agents: boolean): Finding | null => {
  const node = workflow.nodes.find((each) => !RUNNABLE.has(each.type) && !(agents && each.type === "agent.run"));
  if (node !== undefined) return { code: "run.node-unsupported", params: { node: node.id, type: node.type } };
  const commands = workflow.nodes.some((each) => each.type === "command.run" || each.with?.["precheck"] !== undefined);
  return commands && shell === null ? { code: "run.shell-missing", params: {} } : null;
};

// What a new report run (A28) cannot have: a node that may write, or one that needs an OS sandbox where none runs, as a
// command or a precheck until they run in one, and on native Windows, which has none, an agent (Q7).
const reportRefusal = (workflow: WorkflowDefinition): Finding | null => {
  const write = reportOnly(workflow.nodes)[0];
  if (write !== undefined) return write;
  const node = workflow.nodes.find(
    (each) =>
      each.type === "command.run" ||
      each.with?.["precheck"] !== undefined ||
      (process.platform === "win32" && each.type === "agent.run"),
  );
  return node === undefined ? null : { code: "run.sandbox-unavailable", params: { node: node.id } };
};

// What a report run's executors refuse, as a stored run's that its start did not check: a command or precheck outside an
// OS sandbox, and a write, which the ledger also refuses to record. A refused precheck counts as not passed: the run ends
// skipped.
const refusing = (code: string) => (): Prepared => ({
  pid: null,
  run: () => Promise.resolve({ ok: false, values: { error: code } }),
});

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
  const run = { state, runId: lease.runId, project, report: options.report === true };
  const executors: Executors = {
    "command.run": run.report ? refusing("run.sandbox-unavailable") : command(shell, project),
    "file.read": fileRead(project),
    "file.write": run.report ? refusing("run.report-only-apply") : fileWrite(project, state),
    ...(agents === undefined ? {} : { "agent.run": agentRun(run, agents) }),
  };
  // An agent attempt a dead runner left ends with its result or resumes its session, and a write ends with its apply
  // run; every other one ends interrupted.
  const recover = {
    "file.write": writeRecover(state),
    ...(agents === undefined ? {} : { "agent.run": agentRecover(run, agents) }),
  };
  try {
    const { signal, onEvent, sleep } = options;
    const status = await execute(store, lease, held, { executors, signal, onEvent, sleep, recover });
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
  const refusal = options.report === true ? reportRefusal(workflow.value) : null;
  if (refusal !== null) return { ok: false, finding: refusal };
  const project = realFolder(options.project ?? process.cwd());
  if (!project.ok) return project;
  return withGraphs(state, (store) => {
    store.prune(OUTPUT_DAYS);
    const definition = workflow.value;
    const run = {
      definition,
      inputs: typed,
      trigger: "manual",
      mode: options.report === true ? "report" : "act",
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
  takenOver(state, runId, options, () => ({ ok: true, value: [] }));

type First = (run: GraphRun, journal: readonly JournalEvent[]) => Result<JournalEvent[]>;

// Takes over a stored run this version runs in its folder, appends what `first` tells it (or refuses with its finding),
// and runs it on from its journal.
const takenOver = (state: string, runId: string, options: RunOptions, first: First): Promise<Result<GraphOutcome>> =>
  withGraphs(state, async (store) => {
    const run = store.graphRun(runId);
    if (run === undefined) return { ok: false, finding: { code: "run.not-found", params: { runId } } };
    const shell = check(run.definition, run.inputs, options);
    if (!shell.ok) return shell;
    const project = projectOf(run, options.project);
    if (!project.ok) return project;
    const journal = store.events(runId);
    const told = first(run, journal.ok ? journal.value : []);
    if (!told.ok) return told;
    const lease = store.takeOver(runId);
    if (!lease.ok) return lease;
    for (const event of told.value) store.append(runId, lease.value.epoch, event);
    // A stored run runs in the mode it started in.
    const report = run.mode === "report";
    return runOn(store, { run, lease: lease.value }, shell.value, {
      ...options,
      report,
      project: project.value,
      state,
    });
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
): Promise<Result<{ runId: string; status: GraphOutcome["status"] | "cancelling" }>> =>
  withGraphs<{ runId: string; status: GraphOutcome["status"] | "cancelling" }>(state, async (store) => {
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
    // A cancelled run starts nothing, so it needs no shell, and no agent: an attempt left running ends interrupted, but a
    // write whose apply run applied ends cancelled, its file written.
    store.append(runId, lease.value.epoch, { type: "cancel" });
    return runOn(store, { run, lease: lease.value }, "", {
      ...options,
      agents: undefined,
      project: project.ok ? project.value : "",
      state,
    });
  });

/** A node of a graph run that waits for the owner: an approval, or an attempt at a gate with the plan it would apply. */
export interface Waiting {
  readonly node: string;
  readonly point: GatePoint | "human.approval";
  readonly planHash: string | null;
  /** What a write at its gate writes, when the plan built now is the one the gate recorded; null for anything else. */
  readonly content: string | null;
}

// The value a node's data input `handle` gets, as the journal left the node before it, or from a workflow input.
const valueInto = (run: GraphRun, state: RunState | null, node: string, handle: string): Json | undefined => {
  const edge = run.definition.edges.find(({ to }) => "node" in to && to.node === node && to.handle === handle);
  if (edge === undefined) return undefined;
  const { from } = edge;
  return "node" in from ? state?.nodes[from.node]?.values[from.handle] : run.inputs[from.input];
};

// The content of a write waiting at its gate, when the plan its data input gives now is the one the gate recorded.
const contentOf = (run: GraphRun, state: RunState | null, { node, planHash: hash }: Omit<Waiting, "content">) => {
  const value = valueInto(run, state, node, "content");
  const config = run.definition.nodes.find((each) => each.id === node)?.with ?? {};
  const plan = planOf(run.project, { config, data: value === undefined ? {} : { content: value } });
  const [write] = typeof plan === "string" || planHash(plan) !== hash ? [] : plan.operations;
  return write?.kind === "write" ? write.content : null;
};

// What waits in a run: approvals its replay leaves waiting, and attempts whose last record is a gate.
const waitsIn = (run: GraphRun, journal: readonly JournalEvent[]): Waiting[] => {
  const events = journal.flatMap((event) => {
    const parsed = RunEvent.safeParse(event);
    return parsed.success ? [parsed.data] : [];
  });
  const replayed = replay(run.definition, run.inputs, events);
  const state = replayed.ok ? replayed.value : null;
  const approvals = Object.entries(state?.nodes ?? {}).flatMap(([node, { state: at }]) =>
    at === "waiting" ? [{ node, point: "human.approval" as const, planHash: null, content: null }] : [],
  );
  const gates = new Map<string, Omit<Waiting, "content">>();
  for (const event of journal) {
    if (event.type === "gate")
      gates.set(event.node, { node: event.node, point: event.point, planHash: event.planHash });
    else if ("node" in event) gates.delete(event.node);
  }
  return [...approvals, ...[...gates.values()].map((gate) => ({ ...gate, content: contentOf(run, state, gate) }))];
};

/** What a graph run waits for, read without a write. */
export const waitsOf = (state: string, runId: string): Result<{ run: GraphRun; waits: Waiting[] }> =>
  withGraphView(state, (view) => {
    const run = view?.graphRun(runId);
    if (view === null || run === undefined) return { ok: false, finding: { code: "run.not-found", params: { runId } } };
    const journal = view.events(runId);
    return journal.ok ? { ok: true, value: { run, waits: waitsIn(run, journal.value) } } : journal;
  });

/**
 * Records the owner's decision for a node of a graph run that waits for it, takes the run over and runs it on. A
 * decision at a gate before an apply holds the hash of the plan the gate recorded, so it approves that plan only.
 */
export const decideRun = (
  state: string,
  runId: string,
  { node, approved }: { readonly node: string; readonly approved: boolean },
  options: RunOptions,
): Promise<Result<GraphOutcome>> =>
  takenOver(state, runId, options, (run, journal) => {
    const wait = waitsIn(run, journal).find((each) => each.node === node);
    if (wait === undefined) return { ok: false, finding: { code: "run.not-waiting", params: { runId, node } } };
    const plan = wait.planHash === null ? {} : { planHash: wait.planHash };
    return { ok: true, value: [{ type: "decided", node, approved, ...plan }] };
  });
