import { z } from "zod";
import type { Json } from "./json.ts";
import { Sha256 } from "./plan.ts";
import { HandleName, JsonValue, WorkflowDefinition, WorkflowId } from "./workflow.ts";

// Typed as the contracts' Json, which the engine computes with.
const Value: z.ZodType<Json> = JsonValue;
const Values = z.record(HandleName, Value);
const Attempt = z.int().positive();

/** `cancelling`: the run asked to cancel the running attempt, so however it ends, the node ends `cancelled`. */
export const NodeState = z.enum([
  "pending",
  "running",
  "cancelling",
  "waiting",
  "done",
  "failed",
  "skipped",
  "cancelled",
]);
export type NodeState = z.infer<typeof NodeState>;

export const NodeRun = z.strictObject({
  state: NodeState,
  attempts: z.int().nonnegative(),
  /** The outputs that fired: the control output the node took and its data outputs that hold a value. */
  fired: z.array(HandleName),
  values: Values,
});
export type NodeRun = z.infer<typeof NodeRun>;

export const RunStatus = z.enum(["running", "succeeded", "failed", "cancelled", "skipped"]);
export type RunStatus = z.infer<typeof RunStatus>;

/** A graph run as the engine's reducer keeps it; replaying the run's events from the start gives it again. */
export const RunState = z.strictObject({
  status: RunStatus,
  inputs: Values,
  nodes: z.record(WorkflowId, NodeRun),
  /** A failure that no edge routed: the run ends failed. */
  failed: z.boolean(),
  /** Why nothing new starts: a cancel, or a failure under `fail_fast`. */
  stop: z.enum(["cancelled", "failed"]).nullable(),
});
export type RunState = z.infer<typeof RunState>;

/** How an attempt of a node the executor runs ended; an interrupted attempt counts as a failed one. */
export const AttemptOutcome = z.enum(["done", "failed", "timed-out", "interrupted", "cancelled"]);
export type AttemptOutcome = z.infer<typeof AttemptOutcome>;

/** What the engine's reducer reads: each event moves a run's state on. */
export const RunEvent = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("precheck"), passed: z.boolean() }),
  z.strictObject({
    type: z.literal("ended"),
    node: WorkflowId,
    attempt: Attempt,
    outcome: AttemptOutcome,
    values: Values.optional(),
  }),
  z.strictObject({ type: z.literal("decided"), node: WorkflowId, approved: z.boolean() }),
  z.strictObject({ type: z.literal("cancel") }),
]);
export type RunEvent = z.infer<typeof RunEvent>;

/**
 * An entry of a run's event log: the reducer's events, and the executor's records around them, which a replay skips.
 * `started` is committed before its attempt is spawned, `applying` before its apply run writes anything.
 */
export const JournalEvent = z.discriminatedUnion("type", [
  ...RunEvent.options,
  z.strictObject({
    type: z.literal("started"),
    node: WorkflowId,
    attempt: Attempt,
    pid: z.int().positive().nullable(),
  }),
  z.strictObject({ type: z.literal("applying"), node: WorkflowId, attempt: Attempt, applyRun: z.uuid() }),
  z.strictObject({ type: z.literal("finished"), status: RunStatus.exclude(["running"]), outputs: Values }),
  z.strictObject({ type: z.literal("resumed") }),
]);
export type JournalEvent = z.infer<typeof JournalEvent>;

/**
 * A graph run as the ledger keeps it, with its definition as it started. `report`: a run that writes nothing (A28);
 * `interrupted`: no process holds its lease, so another runner may take it over.
 */
export const GraphRun = z.object({
  id: z.uuid(),
  definition: WorkflowDefinition,
  definitionHash: Sha256,
  inputs: Values,
  trigger: z.enum(["manual", "schedule"]),
  mode: z.enum(["act", "report"]),
  status: z.enum([...RunStatus.options, "waiting", "interrupted"]),
  parentRun: z.uuid().nullable(),
  parentNode: WorkflowId.nullable(),
  /** The real path of the project folder its commands run in; null on a run recorded before it was. */
  project: z.string().nullable(),
  /** 1 for the run's first runner, raised by each takeover. */
  epoch: z.int().positive(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
});
export type GraphRun = z.infer<typeof GraphRun>;

/** An attempt of a node as the ledger keeps it; `pid` is the process it started, if it started one. */
export const NodeAttempt = z.object({
  node: WorkflowId,
  attempt: Attempt,
  state: z.enum(["running", ...AttemptOutcome.options]),
  pid: z.int().positive().nullable(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
});
export type NodeAttempt = z.infer<typeof NodeAttempt>;
