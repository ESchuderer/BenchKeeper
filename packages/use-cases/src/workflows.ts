import { type ChildProcess, type ChildProcessByStdio, execFile, spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readSync } from "node:fs";
import { join, win32 } from "node:path";
import type { Readable, Writable } from "node:stream";
import {
  type Finding,
  type JournalEvent,
  type Json,
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
import { type GraphStore, openGraphStore, type RunLease } from "@cedarloom/ledger";
import { cleanEnv } from "@cedarloom/orchestration";
import { readJson } from "./use-cases.ts";

type Values = Record<string, Json>;

/** How a graph run ended. */
export interface GraphOutcome {
  readonly runId: string;
  readonly status: RunStatus;
}

export interface RunOptions {
  /** The project folder: commands run in it, and files are read below it. */
  readonly project: string;
  /** Cancels the run. */
  readonly signal?: AbortSignal | undefined;
  /** Called after each event is committed. */
  readonly onEvent?: ((event: JournalEvent) => void) | undefined;
  /** The POSIX sh for commands; found when absent, null for none. */
  readonly shell?: string | null | undefined;
  /** Waits out a retry's backoff; tests pass one that does not wait. */
  readonly sleep?: ExecuteOptions["sleep"];
}

// The node types that run in this version; the others come with agents, writes and approvals, and schedules.
const RUNNABLE = new Set(["trigger.manual", "command.run", "file.read", "condition", "join"]);

/** The POSIX `sh` that runs commands: /bin/sh, or on Windows Git for Windows' sh.exe on PATH or in its usual folder. */
export const findShell = (platform: NodeJS.Platform = process.platform, env = process.env): string | null => {
  if (platform !== "win32") return "/bin/sh";
  /* v8 ignore start -- Windows only; the Windows CI leg runs it */
  const git = win32.join(env["ProgramFiles"] ?? "C:\\Program Files", "Git", "bin");
  const dirs = [...(env["PATH"] ?? "").split(";"), git];
  return dirs.map((dir) => win32.join(dir, "sh.exe")).find((file) => existsSync(file)) ?? null;
  /* v8 ignore stop */
};

// The shell waits for a line on stdin before it runs the command: when the runner dies before the attempt's start is
// committed, stdin closes and nothing runs. The command comes in the environment, apart from the values.
const GATE = 'read -r _ || exit 125; eval "$CEDARLOOM_COMMAND"';

// A timeout or a cancel ends the command's whole process tree: its process group, or on Windows taskkill /T.
const stop = (child: ChildProcess): void => {
  /* v8 ignore start -- Windows only; the Windows CI leg runs it */
  if (process.platform === "win32") {
    const taskkill = win32.join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "taskkill.exe");
    execFile(taskkill, ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => child.kill());
    return;
  }
  /* v8 ignore stop */
  try {
    process.kill(-Number(child.pid), "SIGKILL");
  } catch {
    // It has ended meanwhile.
  }
};

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
    const abort = (): void => stop(child);
    const closed = new Promise<number | null>((resolve) => {
      child.once("error", () => resolve(null));
      child.once("close", (code) => resolve(code));
    }).finally(() => signal.removeEventListener("abort", abort));
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
const unready = (workflow: WorkflowDefinition, shell: string | null): Finding | null => {
  const node = workflow.nodes.find((each) => !RUNNABLE.has(each.type));
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

// Runs a run this process holds to its end, then lets go of it.
const runHeld = async (
  store: GraphStore,
  held: Held,
  shell: string,
  options: RunOptions,
): Promise<Result<GraphOutcome>> => {
  const { lease } = held;
  const executors: Executors = {
    "command.run": command(shell, options.project),
    "file.read": fileRead(options.project),
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
  const refused = unready(workflow, shell);
  if (refused !== null) return { ok: false, finding: refused };
  const started = startRun(workflow, inputs);
  return started.ok ? { ok: true, value: shell ?? "" } : started;
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
  const shell = check(workflow.value, inputs, options);
  if (!shell.ok) return shell;
  return withGraphs(state, (store) => {
    const definition = workflow.value;
    const run = { definition, inputs, trigger: "manual", mode: "act", parentRun: null, parentNode: null } as const;
    const held = { lease: store.create(run), workflow: definition, inputs, journal: [] };
    return runHeld(store, held, shell.value, options);
  });
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
    const lease = store.takeOver(runId);
    if (!lease.ok) return lease;
    const journal = store.events(runId);
    if (!journal.ok) {
      lease.value.release();
      return journal;
    }
    const held = { lease: lease.value, workflow: run.definition, inputs: run.inputs, journal: journal.value };
    return runHeld(store, held, shell.value, options);
  });
