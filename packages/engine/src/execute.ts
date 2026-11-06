import { setTimeout as sleep } from "node:timers/promises";
import type {
  Finding,
  JournalEvent,
  Json,
  Result,
  RunEvent,
  RunState,
  RunStatus,
  WorkflowDefinition,
} from "@cedarloom/contracts";
import type { GraphStore, RunLease } from "@cedarloom/ledger";
import { own } from "./graph.ts";
import { type Action, startRun, step } from "./schedule.ts";

type Values = Record<string, Json>;
type Start = Extract<Action, { type: "start" }>;
type Ended = (ok: boolean, values: Values, why: unknown) => void;
type Going = { readonly prepared: Prepared; readonly controller: AbortController };
type Typed = { readonly type: string; readonly config: Readonly<Record<string, Json>> };

/** The most of an output value a run keeps: 1 MiB. A longer string is cut there, any other value is dropped. */
export const OUTPUT_CAP = 1024 * 1024;

/** An attempt as its executor gets it: the node's configuration, the run's inputs, and the signal to stop. */
export interface Attempt {
  readonly node: string;
  readonly config: Readonly<Record<string, Json>>;
  readonly inputs: Readonly<Values>;
  /** Aborted with the reason `timed-out`, `cancelled` or `lost` (another runner took the run over). */
  readonly signal: AbortSignal;
}

/**
 * An attempt set up but not yet going: `pid` is its process, if it has one, and `run` lets it go once its start is
 * committed, so no effect comes before its record. Called with the signal aborted already, `run` lets nothing go.
 */
export interface Prepared {
  readonly pid: number | null;
  run(): Promise<{ readonly ok: boolean; readonly values?: Values }>;
}

/** The executors by node type; a trigger's precheck runs as a `command.run` of its command. */
export type Executors = Readonly<Record<string, (attempt: Attempt) => Prepared>>;

export interface ExecuteOptions {
  readonly executors: Executors;
  /** Cancels the run. */
  readonly signal?: AbortSignal | undefined;
  /** Waits out a retry's backoff unless `signal` ends the wait; tests pass one that does not wait. */
  readonly sleep?: ((ms: number, signal: AbortSignal) => Promise<unknown>) | undefined;
  /** Called after each event is committed. */
  readonly onEvent?: ((event: JournalEvent) => void) | undefined;
}

const RUN_EVENTS = new Set(["precheck", "ended", "decided", "cancel"]);
const PRECHECK_TIMEOUT_MS = 120_000;
const key = (node: string, attempt: number): string => `${node}#${attempt}`;
const isRunEvent = (event: JournalEvent): event is RunEvent => RUN_EVENTS.has(event.type);
// A node type without an executor fails each attempt; so does one whose executor throws, with the error's code.
const missing = (): Prepared => ({ pid: null, run: () => Promise.resolve({ ok: false }) });
const thrown = (failure: unknown): Prepared => {
  const code = Reflect.get(Object(failure), "code");
  return { pid: null, run: () => Promise.resolve({ ok: false, values: { error: String(code) } }) };
};
const wait = (ms: number, signal: AbortSignal) => sleep(ms, undefined, { signal });
const nothing = (): void => undefined;
// An end the runner did not cause is the attempt's own; a timeout or a cancel names it.
const outcomeOf = (ok: boolean, why: unknown) => {
  if (why === "timed-out" || why === "cancelled") return why;
  return ok ? "done" : "failed";
};

const bytes = (value: Json): number => Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value));
// A cut through a character ends in a replacement character, which would go over the cap.
const cut = (value: Json): Json =>
  typeof value === "string"
    ? Buffer.from(value)
        .subarray(0, OUTPUT_CAP)
        .toString("utf8")
        .replace(/\uFFFD$/u, "")
    : null;

/** An attempt's values within the cap; `truncated` names the ones it cut. */
export const capped = (values: Values): Values => {
  const over = Object.entries(values).filter(([, value]) => bytes(value) > OUTPUT_CAP);
  if (over.length === 0) return values;
  const kept = Object.fromEntries(over.map(([name, value]) => [name, cut(value)]));
  return { ...values, ...kept, truncated: over.map(([name]) => name) };
};

// The attempts a crashed runner left started: each ends interrupted before anything new starts (Q4).
const interrupted = (journal: readonly JournalEvent[]): JournalEvent[] => {
  const open = new Map<string, JournalEvent>();
  for (const event of journal) {
    if (event.type === "started") {
      const { node, attempt } = event;
      open.set(key(node, attempt), { type: "ended", node, attempt, outcome: "interrupted" });
    } else if (event.type === "ended") open.delete(key(event.node, event.attempt));
  }
  return [...open.values()];
};

// The node state in which an action is still owed.
const OWED = { start: "running", precheck: "running", cancel: "cancelling", wait: "waiting" } as const;

// Whether the journal leaves an action to do: a start not committed, a precheck not answered, a cancel or finish not done.
const isLeft = (action: Action, state: RunState, done: ReadonlySet<string>): boolean => {
  if (action.type === "finish") return !done.has("finished");
  const node = own(state.nodes, action.node);
  const owed = node?.state === OWED[action.type];
  if (action.type === "start")
    return owed && node?.attempts === action.attempt && !done.has(key(action.node, action.attempt));
  return owed && (action.type !== "precheck" || !done.has("precheck"));
};

// The state the journal leads to, and what is left to do: each action on the way that the journal does not show done.
const resumed = (
  workflow: WorkflowDefinition,
  inputs: Readonly<Values>,
  journal: readonly JournalEvent[],
): Result<{ state: RunState; actions: Action[] }> => {
  const begun = startRun(workflow, inputs);
  if (!begun.ok) return begun;
  let { state } = begun.value;
  const actions = [...begun.value.actions];
  for (const event of journal.filter(isRunEvent)) {
    const next = step(workflow, state, event);
    state = next.state;
    actions.push(...next.actions);
  }
  const done = new Set(
    journal.map((event) => (event.type === "started" ? key(event.node, event.attempt) : event.type)),
  );
  const left = actions.filter((action) => isLeft(action, state, done));
  return { ok: true, value: { state, actions: left } };
};

// What a runner works with: the store and lease it writes with, and the run as its journal left it.
interface Held {
  readonly store: GraphStore;
  readonly lease: RunLease;
  readonly workflow: WorkflowDefinition;
  readonly state: RunState;
}

// One run's moves: events go through the inbox one at a time, each committed, then handed to the reducer.
class Runner {
  readonly #ending = new AbortController();
  readonly #live = new Map<string, AbortController>();
  readonly #inbox: RunEvent[] = [];
  readonly #held: Held;
  readonly #options: ExecuteOptions;
  #state: RunState;
  #status: RunStatus = "running";
  #lost: Finding | null = null;
  #wake = nothing;

  constructor(held: Held, options: ExecuteOptions) {
    this.#held = held;
    this.#state = held.state;
    this.#options = options;
  }

  /** Carries out the actions left from the journal, then each event's actions, until the run has finished. */
  async run(actions: readonly Action[]): Promise<Result<RunStatus>> {
    this.#options.signal?.addEventListener("abort", () => this.#post({ type: "cancel" }), { once: true });
    actions.forEach((action) => this.#handle(action));
    while (this.#status === "running" && this.#lost === null) {
      const event = this.#inbox.shift();
      if (event === undefined) {
        await new Promise<void>((resolve) => {
          this.#wake = resolve;
        });
      } else if (this.#commit(event)) {
        if (event.type === "ended") this.#live.delete(event.node);
        const next = step(this.#held.workflow, this.#state, event);
        this.#state = next.state;
        next.actions.forEach((action) => this.#handle(action));
      }
    }
    this.#ending.abort();
    return this.#lost === null ? { ok: true, value: this.#status } : { ok: false, finding: this.#lost };
  }

  // Writes an event with the run's epoch; once a write is refused, every attempt stops and nothing more is written.
  #commit(event: JournalEvent): boolean {
    const { store, lease } = this.#held;
    const written = this.#lost === null ? store.append(lease.runId, lease.epoch, event) : null;
    if (written?.ok === true) this.#options.onEvent?.(event);
    else if (written !== null) {
      this.#lost = written.finding;
      for (const controller of this.#live.values()) controller.abort("lost");
      this.#wake();
    }
    return written?.ok === true;
  }

  #post(event: RunEvent): void {
    this.#inbox.push(event);
    this.#wake();
  }

  #handle(action: Action): void {
    if (action.type === "start") void this.#start(action);
    else if (action.type === "precheck") this.#precheck(action.node);
    else if (action.type === "cancel") this.#cancel(action.node);
    else if (action.type === "finish") {
      this.#commit({ type: "finished", status: action.status, outputs: action.outputs });
      this.#status = action.status;
    }
  }

  #prepare(node: string, { type, config }: Typed): Going {
    const controller = new AbortController();
    const attempt = { node, config, inputs: this.#state.inputs, signal: controller.signal };
    try {
      return { prepared: (own(this.#options.executors, type) ?? missing)(attempt), controller };
    } catch (error) {
      return { prepared: thrown(error), controller };
    }
  }

  // Lets a prepared attempt go until its timeout; `end` gets its result and why it was aborted, if it was.
  async #go(node: string, { prepared, controller }: Going, ms: number, end: Ended): Promise<void> {
    this.#live.set(node, controller);
    const timer = setTimeout(() => controller.abort("timed-out"), ms);
    const { ok, values = {} } = await prepared.run();
    clearTimeout(timer);
    end(ok, capped(values), controller.signal.reason);
  }

  async #start(action: Start): Promise<void> {
    if (action.delayMs > 0 && !(await this.#waited(action.delayMs))) return;
    const { node: id, attempt } = action;
    const node = own(this.#state.nodes, id);
    // A backoff that a stop or a cancel overtook starts nothing.
    if (node?.state !== "running" || node.attempts !== attempt) return;
    const going = this.#prepare(id, this.#of(id));
    if (!this.#commit({ type: "started", node: id, attempt, pid: going.prepared.pid })) going.controller.abort("lost");
    await this.#go(id, going, action.timeoutSeconds * 1000, (ok, values, why) => {
      this.#post({ type: "ended", node: id, attempt, outcome: outcomeOf(ok, why), values });
    });
  }

  // Waits out a retry's backoff; false when the run ended first.
  async #waited(ms: number): Promise<boolean> {
    try {
      await (this.#options.sleep ?? wait)(ms, this.#ending.signal);
      return true;
    } catch {
      return false;
    }
  }

  #of(id: string): Typed {
    const item = this.#held.workflow.nodes.find((each) => each.id === id);
    return { type: item?.type ?? "", config: item?.with ?? {} };
  }

  #precheck(node: string): void {
    const command = this.#of(node).config["precheck"] ?? "";
    const going = this.#prepare(node, { type: "command.run", config: { command } });
    void this.#go(node, going, PRECHECK_TIMEOUT_MS, (ok, _, why) => {
      this.#live.delete(node);
      // A cancel ended the trigger already; a precheck that timed out found nothing to do.
      if (why !== "cancelled") this.#post({ type: "precheck", passed: ok && why === undefined });
    });
  }

  #cancel(node: string): void {
    const running = this.#live.get(node);
    running?.abort("cancelled");
    const current = own(this.#state.nodes, node);
    // An attempt asked to stop before it started (in its backoff, or planned before a crash) ends cancelled at once.
    if (running !== undefined || current?.state !== "cancelling") return;
    const attempt = current.attempts;
    this.#commit({ type: "started", node, attempt, pid: null });
    this.#post({ type: "ended", node, attempt, outcome: "cancelled" });
  }
}

/**
 * Runs a graph run to its end as the runner that holds `lease`, from what its journal holds: nothing for a new run, the
 * events before a crash for one taken over, whose attempts left started end `interrupted` first. Each event is committed
 * before what it records takes effect, one at a time as the run moves, never in a loop of their own. Ends with the
 * run's status, or with the finding of a write the ledger refused, as when another runner took the run over.
 */
export const execute = async (
  store: GraphStore,
  lease: RunLease,
  run: {
    readonly workflow: WorkflowDefinition;
    readonly inputs: Readonly<Values>;
    readonly journal: readonly JournalEvent[];
  },
  options: ExecuteOptions,
): Promise<Result<RunStatus>> => {
  const ends = interrupted(run.journal);
  for (const event of ends) {
    const written = store.append(lease.runId, lease.epoch, event);
    if (!written.ok) return written;
    options.onEvent?.(event);
  }
  const from = resumed(run.workflow, run.inputs, [...run.journal, ...ends]);
  if (!from.ok) return from;
  const runner = new Runner({ store, lease, workflow: run.workflow, state: from.value.state }, options);
  return runner.run(from.value.actions);
};
