import { setTimeout as sleep } from "node:timers/promises";
import type {
  Finding,
  GatePoint,
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
import { type Action, startRun, step, timeoutOf } from "./schedule.ts";

type Values = Record<string, Json>;
type Start = Extract<Action, { type: "start" }>;
type Ended = (ok: boolean, values: Values, why: unknown) => void;
type Going<P = Prepared> = { readonly prepared: P; readonly controller: AbortController };
type Open = { readonly node: string; readonly attempt: number; readonly sessionId: string | null };
type Typed = { readonly type: string; readonly config: Readonly<Record<string, Json>> };

/** The most of an output value a run keeps: 1 MiB. A longer string is cut there, any other value is dropped. */
export const OUTPUT_CAP = 1024 * 1024;

/**
 * An attempt as its executor gets it: the node's configuration, the run's inputs, the values of the node's data inputs,
 * and the signal to stop.
 */
export interface Attempt {
  readonly node: string;
  /** The attempt's number, from 1; 0 for a precheck. */
  readonly attempt: number;
  readonly config: Readonly<Record<string, Json>>;
  readonly inputs: Readonly<Values>;
  readonly data: Readonly<Values>;
  /** Aborted with the reason `timed-out`, `cancelled` or `lost` (another runner took the run over). */
  readonly signal: AbortSignal;
  /** Records the id of the agent session the attempt runs, so that a later runner can resume it. */
  readonly session: (sessionId: string) => void;
  /** Records the apply run the attempt writes through, before it writes; false when the record was refused. */
  readonly applying: (applyRun: string) => boolean;
}

/**
 * An attempt set up but not yet going: `pid` is its process, if it has one, and `run` lets it go once its start is
 * committed, so no effect comes before its record. Called with the signal aborted already, `run` lets nothing go.
 */
export interface Prepared {
  readonly pid: number | null;
  /** The plan the attempt applies, by its hash: it waits at the `before-apply` gate first, holding nothing meanwhile. */
  readonly planHash?: string;
  /** `stalled`: the attempt went quiet for too long, and ends timed out. */
  run(): Promise<{ readonly ok: boolean; readonly values?: Values; readonly stalled?: boolean }>;
}

/**
 * The executors by node type; a trigger's precheck runs as a `command.run` of its command. An executor may wait before
 * its attempt starts, as an agent for an account's lease: the wait is no part of the attempt's timeout.
 */
export type Executors = Readonly<Record<string, (attempt: Attempt) => Prepared | Promise<Prepared>>>;

/** An attempt a dead runner left started, as the runner that took the run over finds it, with its last session. */
export interface Left extends Attempt {
  readonly sessionId: string | null;
}

/**
 * How a runner that took a run over goes on with an attempt a dead runner left started: an attempt to let go, such as
 * one that found its result or resumed its session, or null when nothing is left to go on with: it ends interrupted.
 */
export type Recovery = (left: Left) => Prepared | null | Promise<Prepared | null>;

/** Whether an attempt of the node goes on at a gate, or waits there for the owner's decision. */
export type Gates = (point: GatePoint, node: string) => "pass" | "wait";

/**
 * The gates until the levels' policy (M3 slice 4): a node of a run the user started goes, and a plan a run built waits
 * for the owner's approval of its hash (Q9 b).
 */
export const DEFAULT_GATES: Gates = (point) => (point === "before-apply" ? "wait" : "pass");

// The node types with effects, which a `before-node` gate holds.
const EFFECTS = new Set(["agent.run", "command.run", "file.write", "workflow.run"]);

export interface ExecuteOptions {
  readonly executors: Executors;
  /** Cancels the run. */
  readonly signal?: AbortSignal | undefined;
  /** Waits out a retry's backoff unless `signal` ends the wait; tests pass one that does not wait. */
  readonly sleep?: ((ms: number, signal: AbortSignal) => Promise<unknown>) | undefined;
  /** Called after each event is committed. */
  readonly onEvent?: ((event: JournalEvent) => void) | undefined;
  /** By node type, how a run taken over goes on with an attempt left started; without one it ends interrupted (Q4). */
  readonly recover?: Readonly<Record<string, Recovery>> | undefined;
  /** Where attempts wait for the owner; `DEFAULT_GATES` when unset. */
  readonly gates?: Gates | undefined;
}

const RUN_EVENTS = new Set(["precheck", "ended", "decided", "cancel"]);
const PRECHECK_TIMEOUT_MS = 120_000;
const key = (node: string, attempt: number): string => `${node}#${attempt}`;
const isRunEvent = (event: JournalEvent): event is RunEvent => RUN_EVENTS.has(event.type);
// A node type without an executor fails each attempt; so does one whose executor throws, with the error's code.
const missing = (): Prepared => ({ pid: null, run: () => Promise.resolve({ ok: false }) });
const thrown = (failure: unknown): Prepared => {
  const code = Reflect.get(Object(failure), "code") ?? "unknown";
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

// The attempts a crashed runner left started, each with the session it recorded last.
const opened = (journal: readonly JournalEvent[]): Open[] => {
  const open = new Map<string, Open>();
  for (const event of journal) {
    if (event.type === "started") {
      const { node, attempt } = event;
      open.set(key(node, attempt), { node, attempt, sessionId: null });
    } else if (event.type === "session") {
      const left = open.get(key(event.node, event.attempt));
      if (left !== undefined) open.set(key(event.node, event.attempt), { ...left, sessionId: event.sessionId });
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

type Decided = Extract<JournalEvent, { type: "decided" }>;

// The owner's decisions that no start has used yet, per node and the plan each approves ("" for none): one node may
// wait at both gates, before it starts and before its plan applies. The last decision for a gate counts.
const decisionsOf = (journal: readonly JournalEvent[]): Map<string, Map<string, Decided>> => {
  const open = new Map<string, Map<string, Decided>>();
  for (const event of journal) {
    if (event.type === "decided") open.set(event.node, new Map(open.get(event.node)).set(event.planHash ?? "", event));
    else if (event.type === "started") open.delete(event.node);
  }
  return open;
};

// What a runner works with: the store and lease it writes with, and the run as its journal left it.
interface Held {
  readonly store: GraphStore;
  readonly lease: RunLease;
  readonly workflow: WorkflowDefinition;
  readonly state: RunState;
  readonly decisions: Map<string, Map<string, Decided>>;
}

// One run's moves: events go through the inbox one at a time, each committed, then handed to the reducer.
class Runner {
  readonly #ending = new AbortController();
  readonly #live = new Map<string, AbortController>();
  readonly #inbox: RunEvent[] = [];
  readonly #held: Held;
  readonly #options: ExecuteOptions;
  #state: RunState;
  #status: RunStatus | "waiting" = "running";
  // Starts, prechecks and recoveries on their way: each posts an event or ends quietly.
  #going = 0;
  #lost: Finding | null = null;
  #wake = nothing;

  constructor(held: Held, options: ExecuteOptions) {
    this.#held = held;
    this.#state = held.state;
    this.#options = options;
  }

  /**
   * Goes on with the attempts `left` started, carries out the actions left from the journal, then each event's actions,
   * until the run has finished, or until nothing is on its way and every node left waits for the owner: the run then
   * waits without its runner.
   */
  async run(actions: readonly Action[], left: readonly Open[]): Promise<Result<RunStatus | "waiting">> {
    this.#listen();
    for (const open of left) void this.#tracked(this.#recover(open));
    actions.forEach((action) => this.#handle(action));
    while (this.#status === "running" && this.#lost === null) {
      const event = this.#inbox.shift();
      if (event === undefined) await this.#idle();
      else if (this.#commit(event)) {
        if (event.type === "ended") this.#live.delete(event.node);
        const next = step(this.#held.workflow, this.#state, event);
        this.#state = next.state;
        next.actions.forEach((action) => this.#handle(action));
      }
    }
    this.#ending.abort();
    return this.#lost === null ? { ok: true, value: this.#status } : { ok: false, finding: this.#lost };
  }

  // Turns the signal's abort into a cancel. The run's end removes the listener, so a signal that outlives the run keeps
  // no finished runner.
  #listen(): void {
    const { signal } = this.#options;
    const cancel = (): void => this.#post({ type: "cancel" });
    signal?.addEventListener("abort", cancel, { once: true, signal: this.#ending.signal });
    // A signal that ended already sends no abort event.
    if (signal?.aborted === true) cancel();
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
    if (action.type === "start") void this.#tracked(this.#start(action));
    else if (action.type === "precheck") void this.#tracked(this.#precheck(action.node));
    else if (action.type === "cancel") this.#cancel(action.node);
    else if (action.type === "finish") {
      this.#commit({ type: "finished", status: action.status, outputs: action.outputs });
      this.#status = action.status;
    }
  }

  // Waits for the next event. With none on its way, every node left waits for the owner, and the runner lets go.
  async #idle(): Promise<void> {
    if (this.#going > 0) {
      await new Promise<void>((resolve) => {
        this.#wake = resolve;
      });
    } else if (this.#commit({ type: "waiting" })) this.#status = "waiting";
  }

  async #tracked(work: Promise<void>): Promise<void> {
    this.#going += 1;
    try {
      await work;
    } finally {
      this.#going -= 1;
      this.#wake();
    }
  }

  // Sets an attempt up with `make`; a cancel or a lost run reaches it already while `make` waits. `attempt` 0: a precheck.
  async #prepare<P extends Prepared | null>(
    node: string,
    attempt: number,
    { config, data }: { readonly config: Typed["config"]; readonly data: Readonly<Values> },
    make: (given: Attempt) => P | Promise<P>,
  ): Promise<Going<P | Prepared>> {
    const controller = new AbortController();
    this.#live.set(node, controller);
    const session = (sessionId: string): void => {
      this.#commit({ type: "session", node, attempt, sessionId });
    };
    const applying = (applyRun: string): boolean => this.#commit({ type: "applying", node, attempt, applyRun });
    const { inputs } = this.#state;
    const given = { node, attempt, config, inputs, data, signal: controller.signal, session, applying };
    try {
      return { prepared: await make(given), controller };
    } catch (error) {
      return { prepared: thrown(error), controller };
    }
  }

  #executor(type: string): (given: Attempt) => Prepared | Promise<Prepared> {
    return (given) => (own(this.#options.executors, type) ?? missing)(given);
  }

  // Goes on with an attempt a dead runner left started, through its type's recovery; it ends interrupted when that finds
  // nothing to go on with.
  async #recover({ node, attempt, sessionId }: Open): Promise<void> {
    const { type, config } = this.#of(node);
    const recovery = own(this.#options.recover, type);
    // An agent's recovery reads no data inputs.
    const setup = { config, data: {} };
    const going = await this.#prepare(node, attempt, setup, (given) => recovery?.({ ...given, sessionId }) ?? null);
    if (going.prepared === null) {
      this.#post({ type: "ended", node, attempt, outcome: "interrupted" });
      return;
    }
    const { prepared, controller } = going;
    await this.#go({ prepared, controller }, timeoutOf(this.#held.workflow, node, type) * 1000, (ok, values, why) => {
      this.#post({ type: "ended", node, attempt, outcome: outcomeOf(ok, why), values });
    });
  }

  // Lets a prepared attempt go until its timeout; `end` gets its result and why it was aborted, if it was.
  async #go({ prepared, controller }: Going, ms: number, end: Ended): Promise<void> {
    const timer = setTimeout(() => controller.abort("timed-out"), ms);
    // An executor whose run throws fails its attempt, as one whose setup throws does.
    const { ok, values = {}, stalled = false } = await prepared.run().catch((error: unknown) => thrown(error).run());
    clearTimeout(timer);
    end(ok, capped(values), controller.signal.reason ?? (stalled ? "timed-out" : undefined));
  }

  async #start(action: Start): Promise<void> {
    if (action.delayMs > 0 && !(await this.#waited(action.delayMs))) return;
    const { node: id, attempt } = action;
    const node = own(this.#state.nodes, id);
    // A backoff that a stop or a cancel overtook starts nothing.
    if (node?.state !== "running" || node.attempts !== attempt) return;
    const going = await this.#gated(id, attempt, action.inputs);
    if (going === null) return;
    if (!this.#commit({ type: "started", node: id, attempt, pid: going.prepared.pid })) going.controller.abort("lost");
    await this.#go(going, action.timeoutSeconds * 1000, (ok, values, why) => {
      this.#post({ type: "ended", node: id, attempt, outcome: outcomeOf(ok, why), values });
    });
  }

  // The attempt set up past its gates; null when it waits at one or the owner rejected it.
  async #gated(id: string, attempt: number, data: Readonly<Values>): Promise<Going | null> {
    const { type, config } = this.#of(id);
    if (EFFECTS.has(type) && !this.#cleared(id, attempt, "before-node", null)) return null;
    const going = await this.#prepare(id, attempt, { config, data }, this.#executor(type));
    const { planHash } = going.prepared;
    if (planHash === undefined || this.#cleared(id, attempt, "before-apply", planHash)) return going;
    this.#live.delete(id);
    return null;
  }

  /**
   * Whether an attempt goes on at a gate: the policy lets it, or the owner approved it, for the plan it applies if it has
   * one. A rejection fails the attempt; without a decision, the gate is recorded and the attempt waits.
   */
  #cleared(node: string, attempt: number, point: GatePoint, planHash: string | null): boolean {
    if ((this.#options.gates ?? DEFAULT_GATES)(point, node) === "pass") return true;
    const decisions = this.#held.decisions.get(node);
    const decision = decisions?.get(planHash ?? "");
    if (decision === undefined) {
      this.#commit({ type: "gate", node, attempt, point, planHash });
      return false;
    }
    decisions?.delete(planHash ?? "");
    if (decision.approved) return true;
    this.#commit({ type: "started", node, attempt, pid: null });
    this.#post({ type: "ended", node, attempt, outcome: "failed", values: { error: "rejected" } });
    return false;
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

  async #precheck(node: string): Promise<void> {
    const command = this.#of(node).config["precheck"] ?? "";
    const going = await this.#prepare(node, 0, { config: { command }, data: {} }, this.#executor("command.run"));
    await this.#go(going, PRECHECK_TIMEOUT_MS, (ok, _, why) => {
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
 * events before a crash for one taken over. Its attempts left started go on through their type's recovery, or end
 * `interrupted` first. Each event is committed before what it records takes effect, one at a time as the run moves,
 * never in a loop of their own. Ends with the run's status, `waiting` when every node left waits for the owner, or with
 * the finding of a write the ledger refused, as when another runner took the run over.
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
): Promise<Result<RunStatus | "waiting">> => {
  const typeOf = (node: string): string => run.workflow.nodes.find((each) => each.id === node)?.type ?? "";
  const left = opened(run.journal);
  const kept = left.filter(({ node }) => own(options.recover, typeOf(node)) !== undefined);
  // An attempt of a type without a recovery ends interrupted before anything new starts (Q4).
  const ends = left
    .filter((open) => !kept.includes(open))
    .map(({ node, attempt }): JournalEvent => ({ type: "ended", node, attempt, outcome: "interrupted" }));
  for (const event of ends) {
    const written = store.append(lease.runId, lease.epoch, event);
    if (!written.ok) return written;
    options.onEvent?.(event);
  }
  const from = resumed(run.workflow, run.inputs, [...run.journal, ...ends]);
  if (!from.ok) return from;
  const { state } = from.value;
  const decisions = decisionsOf(run.journal);
  const runner = new Runner({ store, lease, workflow: run.workflow, state, decisions }, options);
  return runner.run(from.value.actions, kept);
};
