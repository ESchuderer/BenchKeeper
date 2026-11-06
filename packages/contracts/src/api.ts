import { z } from "zod";
import { Finding } from "./findings.ts";
import { DeleteFile, PLAN_SCHEMA_VERSION, Sha256, WriteFile } from "./plan.ts";
import { contracts } from "./registry.ts";
import { WorkflowId } from "./workflow.ts";

// Run and Step parse rows of the run store too, so unknown columns are dropped, not refused.

/** A run in the journal; `interrupted`: it was running when its process ended. */
export const Run = z
  .object({
    id: z.string(),
    kind: z.enum(["apply", "undo"]),
    undoes: z.string().nullable(),
    planHash: Sha256,
    status: z.enum(["running", "applied", "failed", "interrupted"]),
    epoch: z.int(),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().nullable(),
  })
  .register(contracts, { id: "Run" });
export type Run = z.infer<typeof Run>;

/** One operation of a run as the journal records it; `after` is null for a delete. */
export const Step = z
  .object({
    index: z.int(),
    path: z.string(),
    before: Sha256.nullable(),
    after: Sha256.nullable(),
    state: z.enum(["pending", "running", "done", "skipped"]),
    mode: z.int().nullable(),
  })
  .register(contracts, { id: "Step" });
export type Step = z.infer<typeof Step>;

const summary = z.strictObject({
  schemaVersion: z.literal(PLAN_SCHEMA_VERSION),
  operations: z.array(
    z.union([DeleteFile, WriteFile.omit({ content: true }).extend({ after: Sha256, bytes: z.int().min(0) })]),
  ),
});

/** A plan as previews show it: no file contents, which can hold secrets, but their hash and size. */
export const PlanPreview = z
  .strictObject({ planHash: Sha256, plan: summary })
  .register(contracts, { id: "PlanPreview" });
export type PlanPreview = z.infer<typeof PlanPreview>;

const findings = z.array(Finding);

/**
 * The plan that would undo a run, or none (`planHash` and `plan` both null), and the files it leaves because they were
 * edited since. One object with nullable fields, not a union: generated clients drop properties typed only as null.
 */
export const UndoPreview = z
  .strictObject({ planHash: Sha256.nullable(), plan: summary.nullable(), findings })
  .register(contracts, { id: "UndoPreview" });
export type UndoPreview = z.infer<typeof UndoPreview>;

/** How a change ended; a run that stopped midway carries a `run.failed` finding that names it and its undo. */
export const RunResult = z
  .strictObject({
    runId: z.string().nullable(),
    status: z.enum(["applied", "failed", "refused", "nothing-to-undo"]),
    findings,
  })
  .register(contracts, { id: "RunResult" });
export type RunResult = z.infer<typeof RunResult>;

/** Why a request was refused: the findings, codes and parameters only. */
export const Refusal = z.strictObject({ findings }).register(contracts, { id: "Refusal" });

/** A `runs` event of the event stream (GET /api/events): the runs as they stand, sent whenever they change. */
export const RunsEvent = z.strictObject({ runs: z.array(Run) }).register(contracts, { id: "RunsEvent" });

const savedAt = z.iso.datetime().describe("When the draft was last saved");

/**
 * A workflow document (WorkflowDefinition.schema.json). The API passes it as JSON, and each side reads it with
 * readDocument, which also refuses values nested over 32 levels before the schema runs.
 */
export const WorkflowJson = z
  .unknown()
  .describe("A workflow document, as in WorkflowDefinition.schema.json")
  .register(contracts, { id: "WorkflowJson" });

/**
 * A draft as the list shows it, without its contents: the working copy of one workflow in the state folder, saved by
 * the editor while it is open, so a reload or a closed window loses nothing.
 */
export const DraftInfo = z
  .strictObject({ id: WorkflowId, savedAt, bytes: z.int().min(0) })
  .register(contracts, { id: "DraftInfo" });
export type DraftInfo = z.infer<typeof DraftInfo>;

/** A draft with its workflow; a later save names `hash` as the version it replaces. */
export const Draft = z
  .strictObject({ id: WorkflowId, savedAt, hash: Sha256, workflow: WorkflowJson })
  .register(contracts, { id: "Draft" });
export type Draft = z.infer<typeof Draft>;

/** A saved draft; `overwrote`: the draft had changed since the version the save named (another tab saved it). */
export const DraftSaved = z
  .strictObject({ id: WorkflowId, savedAt, hash: Sha256, bytes: z.int().min(0), overwrote: z.boolean() })
  .register(contracts, { id: "DraftSaved" });
export type DraftSaved = z.infer<typeof DraftSaved>;
