import { type Finding, findingInfo, type Json, type Result, type WorkflowDefinition } from "@cedarloom/contracts";
import { NODE_TYPES, own } from "./graph.ts";
import { validateWorkflow } from "./validate.ts";

type Workflow = WorkflowDefinition;
type Edge = Workflow["edges"][number];
type Values = Record<string, Json>;

/** `cancelling`: the run asked to cancel the running attempt, so however it ends, the node ends `cancelled`. */
export type NodeState = "pending" | "running" | "cancelling" | "waiting" | "done" | "failed" | "skipped" | "cancelled";
export interface NodeRun {
  readonly state: NodeState;
  readonly attempts: number;
  /** The outputs that fired: the control output the node took and its data outputs that hold a value. */
  readonly fired: readonly string[];
  readonly values: Readonly<Values>;
}
export type RunStatus = "running" | "succeeded" | "failed" | "cancelled" | "skipped";
export interface RunState {
  readonly status: RunStatus;
  readonly inputs: Readonly<Values>;
  readonly nodes: Readonly<Record<string, NodeRun>>;
  /** A failure that no edge routed: the run ends failed. */
  readonly failed: boolean;
  /** Why nothing new starts: a cancel, or a failure under `fail_fast`. */
  readonly stop: "cancelled" | "failed" | null;
}

/** How an attempt of a node the executor runs ended; an interrupted attempt counts as a failed one. */
export type AttemptOutcome = "done" | "failed" | "timed-out" | "interrupted" | "cancelled";
export type RunEvent =
  | { readonly type: "precheck"; readonly passed: boolean }
  | {
      readonly type: "ended";
      readonly node: string;
      readonly attempt: number;
      readonly outcome: AttemptOutcome;
      readonly values?: Readonly<Values>;
    }
  | { readonly type: "decided"; readonly node: string; readonly approved: boolean }
  | { readonly type: "cancel" };
export type Action =
  | { readonly type: "precheck"; readonly node: string }
  | {
      readonly type: "start";
      readonly node: string;
      readonly attempt: number;
      readonly delayMs: number;
      readonly timeoutSeconds: number;
      readonly inputs: Readonly<Values>;
    }
  | { readonly type: "wait"; readonly node: string }
  | { readonly type: "cancel"; readonly node: string }
  | { readonly type: "finish"; readonly status: Exclude<RunStatus, "running">; readonly outputs: Readonly<Values> };
export interface Step {
  readonly state: RunState;
  readonly actions: readonly Action[];
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? U[] : T[K] };
// The step's working copy keeps the nodes in a Map, so no node id can reach a property of an object's prototype.
type Run = Omit<Mutable<RunState>, "nodes"> & { nodes: Map<string, Mutable<NodeRun>> };
type Item = Workflow["nodes"][number];
interface Ctx {
  readonly workflow: Workflow;
  readonly run: Run;
  readonly actions: Action[];
  readonly incoming: ReadonlyMap<string, readonly Edge[]>;
  readonly outgoing: ReadonlyMap<string, readonly Edge[]>;
  readonly types: ReadonlyMap<string, string>;
}

const DEFAULT_CONCURRENCY = 4;
const ACTIVE: readonly NodeState[] = ["running", "cancelling", "waiting"];

const byNode = (edges: readonly Edge[], end: "from" | "to"): Map<string, Edge[]> => {
  const map = new Map<string, Edge[]>();
  for (const edge of edges) {
    const at = edge[end];
    if ("node" in at) map.set(at.node, [...(map.get(at.node) ?? []), edge]);
  }
  return map;
};

// A copy the step may change; values are JSON, replaced whole, never changed in place.
const copy = (state: RunState): Run => ({
  ...state,
  inputs: { ...state.inputs },
  nodes: new Map(
    Object.entries(state.nodes).map(([id, node]) => [
      id,
      { ...node, fired: [...node.fired], values: { ...node.values } },
    ]),
  ),
});

const context = (workflow: Workflow, state: RunState): Ctx => ({
  workflow,
  run: copy(state),
  actions: [],
  incoming: byNode(workflow.edges, "to"),
  outgoing: byNode(workflow.edges, "from"),
  types: new Map(workflow.nodes.map((node) => [node.id, node.type])),
});

const kind = (type: string): "trigger" | "pure" | "approval" | "task" => {
  if (type.startsWith("trigger.")) return "trigger";
  if (type === "condition" || type === "join") return "pure";
  return type === "human.approval" ? "approval" : "task";
};

/** Whether an edge fired, is dead (its source ended without it, was skipped or cancelled), or is still open. */
const flow = (ctx: Ctx, edge: Edge): "fired" | "dead" | "open" => {
  if (!("node" in edge.from)) return Object.hasOwn(ctx.run.inputs, edge.from.input) ? "fired" : "dead";
  const source = ctx.run.nodes.get(edge.from.node);
  if (source?.state === "pending" || ACTIVE.includes(source?.state ?? "done")) return "open";
  return source?.fired.includes(edge.from.handle) === true ? "fired" : "dead";
};

const valueOf = (ctx: Ctx, edge: Edge): Json | undefined =>
  "node" in edge.from ? ctx.run.nodes.get(edge.from.node)?.values[edge.from.handle] : ctx.run.inputs[edge.from.input];

const handleOf = (ctx: Ctx, id: string, handle: string) =>
  own(own(NODE_TYPES, ctx.types.get(id) ?? "")?.inputs, handle);

/** The values of a node's data inputs whose edge fired. */
const inputsOf = (ctx: Ctx, id: string): Values =>
  Object.fromEntries(
    (ctx.incoming.get(id) ?? []).flatMap((edge) => {
      const value = valueOf(ctx, edge);
      const handle = "node" in edge.to ? edge.to.handle : "";
      return handleOf(ctx, id, handle)?.type !== "control" && value !== undefined ? [[handle, value]] : [];
    }),
  );

// What one edge into a node means for it: a dead control edge, or a dead edge into a required input, skips it.
const edgeVerdict = (ctx: Ctx, id: string, edge: Edge): "skip" | "open" | "ok" => {
  const state = flow(ctx, edge);
  if (state === "open") return "open";
  const handle = handleOf(ctx, id, "node" in edge.to ? edge.to.handle : "");
  const needed = handle?.type === "control" || handle?.required === true;
  return state === "dead" && needed ? "skip" : "ok";
};

/**
 * Skip propagation (owner, 2026-11-05): a node runs once every control edge into it fired, and a node with a dead
 * control edge, or a dead edge into a required data input, is skipped; branches meet again only in a join with `any`.
 */
const readiness = (ctx: Ctx, id: string): "ready" | "skip" | "wait" => {
  const incoming = ctx.incoming.get(id) ?? [];
  // A node no control edge leads into never gets the order to run.
  if (!incoming.some((edge) => handleOf(ctx, id, "node" in edge.to ? edge.to.handle : "")?.type === "control")) {
    return "skip";
  }
  const verdicts = incoming.map((edge) => edgeVerdict(ctx, id, edge));
  if (verdicts.includes("skip")) return "skip";
  return verdicts.includes("open") ? "wait" : "ready";
};

const end = (node: Mutable<NodeRun>, state: NodeState, fired: string[] = [], values: Values = {}): void => {
  Object.assign(node, { state, fired, values });
};

// The nodes that lead only into `join`: every edge out of them ends at the join or at another such node.
const onlyInto = (ctx: Ctx, join: string): Set<string> => {
  const set = new Set([join]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [id, edges] of ctx.outgoing) {
      if (set.has(id) || edges.length === 0) continue;
      if (edges.every((edge) => "node" in edge.to && set.has(edge.to.node))) grew = Boolean(set.add(id));
    }
  }
  set.delete(join);
  return set;
};

/** A join: `all` once every branch fired (skipped when one is dead), `any` at the first branch that fired. */
const joined = (ctx: Ctx, id: string, policy: unknown): "done" | "skip" | "wait" => {
  const flows = (ctx.incoming.get(id) ?? []).map((edge) => flow(ctx, edge));
  if (policy === "any") {
    if (flows.includes("fired")) return "done";
    return flows.includes("open") ? "wait" : "skip";
  }
  if (flows.includes("dead")) return "skip";
  return flows.includes("open") ? "wait" : "done";
};

/**
 * A pending node ends cancelled; a waiting approval or a running precheck ends at once and the executor drops it; a
 * running attempt is asked to stop and becomes `cancelling`, recorded, so a resumed run knows it too.
 */
const cancelNode = (ctx: Ctx, id: string): void => {
  const node = ctx.run.nodes.get(id);
  if (node?.state === "pending") return end(node, "cancelled");
  if (node === undefined || !(node.state === "waiting" || node.state === "running")) return;
  if (stopsAtOnce(ctx, id, node)) end(node, "cancelled");
  else node.state = "cancelling";
  ctx.actions.push({ type: "cancel", node: id });
};

// An approval's question or a trigger's precheck has no attempt to wait for.
const stopsAtOnce = (ctx: Ctx, id: string, node: Mutable<NodeRun>): boolean =>
  node.state === "waiting" || kind(ctx.types.get(id) ?? "") === "trigger";

// Q5: the branches a `join any` no longer needs are cancelled, so their agents spend nothing more.
const settleJoin = (ctx: Ctx, id: string, node: Mutable<NodeRun>, policy: unknown): boolean => {
  const verdict = joined(ctx, id, policy);
  if (verdict === "wait") return false;
  if (verdict === "skip") end(node, "skipped");
  else {
    end(node, "done", ["done"]);
    if (policy === "any") for (const other of onlyInto(ctx, id)) cancelNode(ctx, other);
  }
  return true;
};

const timeoutOf = (ctx: Ctx, id: string, type: string): number =>
  own(ctx.workflow.execution?.nodes, id)?.timeoutSeconds ?? (type === "agent.run" ? 7200 : 600);

const start = (ctx: Ctx, id: string, type: string, attempt: number): void => {
  // Backoff before a retry: 5 s, doubled per failed attempt, at most 5 min.
  const delayMs = attempt === 1 ? 0 : Math.min(5000 * 2 ** (attempt - 2), 300_000);
  const timeoutSeconds = timeoutOf(ctx, id, type);
  ctx.actions.push({ type: "start", node: id, attempt, delayMs, timeoutSeconds, inputs: inputsOf(ctx, id) });
};

/** A failure after the last attempt: routed along an edge from `failed`, else the failure policy applies. */
const fail = (ctx: Ctx, id: string, node: Mutable<NodeRun>, values: Values = {}): void => {
  if (routes(ctx, id)) return end(node, "failed", ["failed", ...Object.keys(values)], values);
  end(node, "failed");
  ctx.run.failed = true;
  if (policyOf(ctx, id) === "fail_fast") stop(ctx, "failed");
};

const routes = (ctx: Ctx, id: string): boolean =>
  (ctx.outgoing.get(id) ?? []).some((edge) => "node" in edge.from && edge.from.handle === "failed");

// The node's own policy, else the run's, else `fail_fast`.
const policyOf = (ctx: Ctx, id: string): string =>
  own(ctx.workflow.execution?.nodes, id)?.failurePolicy ?? ctx.workflow.execution?.failurePolicy ?? "fail_fast";

const stop = (ctx: Ctx, why: "cancelled" | "failed"): void => {
  ctx.run.stop ??= why;
  for (const id of ctx.run.nodes.keys()) cancelNode(ctx, id);
};

// A value that is no boolean (from a `json` edge, checked when the run gets there) fails the condition.
const decideCondition = (ctx: Ctx, id: string, node: Mutable<NodeRun>): void => {
  const value = inputsOf(ctx, id)["value"];
  if (typeof value === "boolean") end(node, "done", [String(value)]);
  else fail(ctx, id, node);
};

// A pure node or an approval decides here, a skip too; a node the executor runs is left for `launch`.
const settleOne = (ctx: Ctx, { id, type, with: config }: Item): boolean => {
  const node = ctx.run.nodes.get(id);
  if (node?.state !== "pending" || kind(type) === "trigger") return false;
  if (type === "join") return settleJoin(ctx, id, node, config?.["policy"]);
  const verdict = readiness(ctx, id);
  if (verdict === "skip") end(node, "skipped");
  if (verdict !== "ready" || kind(type) === "task") return verdict === "skip";
  if (type === "condition") decideCondition(ctx, id, node);
  else {
    node.state = "waiting";
    ctx.actions.push({ type: "wait", node: id });
  }
  return true;
};

/** Settles the pure nodes, approvals and skips until nothing changes, in the workflow's node order. */
const settle = (ctx: Ctx): void => {
  for (let changed = true; changed && ctx.run.stop === null; ) {
    changed = false;
    for (const item of ctx.workflow.nodes) changed ||= settleOne(ctx, item);
  }
};

/** Starts the ready nodes the executor runs, up to `maxConcurrency` running at once. */
const launch = (ctx: Ctx): void => {
  if (ctx.run.stop !== null) return;
  const limit = ctx.workflow.execution?.maxConcurrency ?? DEFAULT_CONCURRENCY;
  let running = [...ctx.run.nodes.values()].filter((node) => node.state === "running").length;
  for (const { id, type } of ctx.workflow.nodes) {
    const node = ctx.run.nodes.get(id);
    if (running >= limit || node?.state !== "pending" || kind(type) !== "task") continue;
    if (readiness(ctx, id) !== "ready") continue;
    Object.assign(node, { state: "running", attempts: 1 });
    start(ctx, id, type, 1);
    running += 1;
  }
};

const outputsOf = (ctx: Ctx): Values =>
  Object.fromEntries(
    ctx.workflow.edges.flatMap((edge) => {
      const value = "output" in edge.to && flow(ctx, edge) === "fired" ? valueOf(ctx, edge) : undefined;
      return "output" in edge.to && value !== undefined ? [[edge.to.output, value]] : [];
    }),
  );

const finish = (ctx: Ctx): void => {
  const nodes = [...ctx.run.nodes.values()];
  // In a DAG nothing stays pending once no node runs or waits: a stop has cancelled the rest, else all were decided.
  if (ctx.run.status !== "running" || nodes.some((node) => ACTIVE.includes(node.state))) return;
  let status: Exclude<RunStatus, "running"> = ctx.run.failed ? "failed" : "succeeded";
  if (ctx.run.stop === "cancelled") status = "cancelled";
  ctx.run.status = status;
  ctx.actions.push({ type: "finish", status, outputs: outputsOf(ctx) });
};

// Nothing settles or starts before the trigger fired, which waits for its precheck.
const triggered = (ctx: Ctx): boolean =>
  ctx.workflow.nodes.some((node) => kind(node.type) === "trigger" && ctx.run.nodes.get(node.id)?.state === "done");

const advance = (ctx: Ctx): Step => {
  if (triggered(ctx)) {
    settle(ctx);
    launch(ctx);
  }
  finish(ctx);
  return { state: { ...ctx.run, nodes: Object.fromEntries(ctx.run.nodes) }, actions: ctx.actions };
};

// Another attempt while the run goes on and the node has retries left (an interrupted attempt counts, Q4).
const retryable = (ctx: Ctx, id: string, attempts: number): boolean =>
  ctx.run.stop === null && attempts <= (own(ctx.workflow.execution?.nodes, id)?.retries ?? 0);

// The values of the node type's data outputs only: a value named like a control output fires nothing.
const dataValues = (ctx: Ctx, id: string, values: Readonly<Values> = {}): Values => {
  const outputs = own(NODE_TYPES, ctx.types.get(id) ?? "")?.outputs;
  return Object.fromEntries(
    Object.entries(values).filter(([name]) => (own(outputs, name)?.type ?? "control") !== "control"),
  );
};

/**
 * The end of an attempt. After a cancel the run asked for, any end is `cancelled`; a `cancelled` the run did not ask
 * for counts as a failure, like an interrupted attempt, since its effect is unknown.
 */
const ended = (ctx: Ctx, event: Extract<RunEvent, { type: "ended" }>): void => {
  const node = ctx.run.nodes.get(event.node);
  if (event.attempt !== node?.attempts || !(node.state === "running" || node.state === "cancelling")) return;
  if (node.state === "cancelling") return end(node, "cancelled");
  const values = dataValues(ctx, event.node, event.values);
  if (event.outcome === "done") return end(node, "done", ["done", ...Object.keys(values)], values);
  if (!retryable(ctx, event.node, node.attempts)) return fail(ctx, event.node, node, values);
  node.attempts += 1;
  start(ctx, event.node, ctx.types.get(event.node) ?? "", node.attempts);
};

const decided = (ctx: Ctx, event: Extract<RunEvent, { type: "decided" }>): void => {
  const node = ctx.run.nodes.get(event.node);
  if (node?.state === "waiting") end(node, "done", [event.approved ? "approved" : "rejected"]);
};

const prechecked = (ctx: Ctx, passed: boolean): void => {
  const trigger = ctx.workflow.nodes.find((item) => kind(item.type) === "trigger")?.id ?? "";
  const node = ctx.run.nodes.get(trigger);
  if (node?.state !== "running") return;
  if (passed) return end(node, "done", ["start"]);
  // The precheck found nothing to do: the run ends skipped, and no node runs.
  for (const other of ctx.run.nodes.values()) end(other, "skipped");
  ctx.run.status = "skipped";
  ctx.actions.push({ type: "finish", status: "skipped", outputs: {} });
};

const apply = (ctx: Ctx, event: RunEvent): void => {
  if (event.type === "cancel") return stop(ctx, "cancelled");
  if (event.type === "ended") return ended(ctx, event);
  if (event.type === "decided") return decided(ctx, event);
  return prechecked(ctx, event.passed);
};

/** The next state and actions after an event; events for an attempt that is no longer running are ignored. */
export const step = (workflow: Workflow, state: RunState, event: RunEvent): Step => {
  const ctx = context(workflow, state);
  if (ctx.run.status !== "running") return { state, actions: [] };
  apply(ctx, event);
  return advance(ctx);
};

const typeMatches = (type: string, value: Json): boolean =>
  type === "json" || (type === "number" ? Number.isFinite(value) : typeof value === type);

/** The run's inputs: those given, checked against their type, else the input's `default`; a required one must be there. */
export const resolveInputs = (workflow: Workflow, given: Readonly<Values>): Result<Values> => {
  const declared = workflow.inputs ?? {};
  const unknown = Object.keys(given).find((name) => !Object.hasOwn(declared, name));
  if (unknown !== undefined) return { ok: false, finding: { code: "run.input-unknown", params: { input: unknown } } };
  const values: [string, Json][] = [];
  for (const [name, input] of Object.entries(declared)) {
    const value = Object.hasOwn(given, name) ? given[name] : input.default;
    if (value === undefined && input.required === true) {
      return { ok: false, finding: { code: "run.input-missing", params: { input: name } } };
    }
    if (value !== undefined && !typeMatches(input.type, value)) {
      return { ok: false, finding: { code: "run.input-invalid", params: { input: name, type: input.type } } };
    }
    if (value !== undefined) values.push([name, value]);
  }
  return { ok: true, value: Object.fromEntries(values) };
};

const errorOf = (workflow: Workflow): Finding | undefined =>
  validateWorkflow(workflow).find((finding) => findingInfo[finding.code].severity === "error");

/**
 * Starts a run of a workflow without errors: its inputs resolved, its trigger's `precheck` asked for, or the trigger
 * fired at once. The engine's executor then feeds each event to `step` and carries out the actions.
 */
export const startRun = (workflow: Workflow, given: Readonly<Values>): Result<Step> => {
  const error = errorOf(workflow);
  if (error !== undefined) return { ok: false, finding: error };
  const inputs = resolveInputs(workflow, given);
  if (!inputs.ok) return inputs;
  const nodes = Object.fromEntries(
    workflow.nodes.map(({ id }): [string, NodeRun] => [id, { state: "pending", attempts: 0, fired: [], values: {} }]),
  );
  const ctx = context(workflow, { status: "running", inputs: inputs.value, nodes, failed: false, stop: null });
  const trigger = workflow.nodes.find((node) => kind(node.type) === "trigger");
  const node = ctx.run.nodes.get(trigger?.id ?? "");
  if (trigger !== undefined && node !== undefined) {
    if (typeof trigger.with?.["precheck"] === "string") {
      node.state = "running";
      ctx.actions.push({ type: "precheck", node: trigger.id });
    } else end(node, "done", ["start"]);
  }
  return { ok: true, value: advance(ctx) };
};

/** The state a list of events leads to from the start: what a resumed run continues from. */
export const replay = (workflow: Workflow, given: Readonly<Values>, events: readonly RunEvent[]): Result<RunState> => {
  const started = startRun(workflow, given);
  if (!started.ok) return started;
  return { ok: true, value: events.reduce((state, event) => step(workflow, state, event).state, started.value.state) };
};
