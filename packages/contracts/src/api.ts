import { z } from "zod";
import { Finding } from "./findings.ts";
import { ImportReview } from "./imports.ts";
import { DeleteFile, GitOid, PLAN_SCHEMA_VERSION, Sha256, StoreUpdate, WriteFile } from "./plan.ts";
import { PartProbe, ProfileLevel } from "./profile.ts";
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

/**
 * One operation of a run as the journal records it; `after` is null for a delete. A store update journals its branch as
 * the path and commits as before and after.
 */
export const Step = z
  .object({
    index: z.int(),
    path: z.string(),
    before: z.union([Sha256, GitOid]).nullable(),
    after: z.union([Sha256, GitOid]).nullable(),
    state: z.enum(["pending", "running", "done", "skipped"]),
    mode: z.int().nullable(),
  })
  .register(contracts, { id: "Step" });
export type Step = z.infer<typeof Step>;

const summary = z.strictObject({
  schemaVersion: z.literal(PLAN_SCHEMA_VERSION),
  operations: z.array(
    z.union([
      DeleteFile,
      WriteFile.omit({ content: true }).extend({ after: Sha256, bytes: z.int().min(0) }),
      StoreUpdate,
    ]),
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

/**
 * An import's review and, when anything is new or updated, its plan under an id, which POST
 * /api/imports/{importId}/apply applies with the approved `planHash`; otherwise `id`, `planHash` and `plan` are null.
 */
export const ImportPreview = z
  .strictObject({
    id: z.uuid().nullable(),
    review: ImportReview,
    planHash: Sha256.nullable(),
    plan: summary.nullable(),
  })
  .register(contracts, { id: "ImportPreview" });

/**
 * A part of the selected profile: its id (`level.id`), whether it is on at this machine's level, and `when`, the probe
 * of an auto part the selection leaves to it, which a project runs in that project.
 */
export const ProfilePart = z
  .strictObject({
    id: z.string(),
    level: ProfileLevel,
    title: z.string(),
    description: z.string().nullable(),
    on: z.boolean(),
    when: PartProbe.nullable(),
  })
  .register(contracts, { id: "ProfilePart" });
export type ProfilePart = z.infer<typeof ProfilePart>;

/**
 * The selected profile's parts, and this machine's plan (null: no file to change) with its drift lines and what keeps
 * parts from applying; `held`: a line holds the plan back, so `profiles apply` refuses it.
 */
export const ProfileView = z
  .strictObject({ parts: z.array(ProfilePart), plan: summary.nullable(), findings, held: z.boolean() })
  .register(contracts, { id: "ProfileView" });

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
export type RunsEvent = z.infer<typeof RunsEvent>;

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

/**
 * A usage window of a claude-swap account: the share used in percent, when it resets, and when claude-swap read it
 * (null: claude-swap no longer trusts that share, so it is the last one it trusted, or none); `usedPercent` is null when
 * claude-swap has no share for that window.
 */
const SwapWindow = z.strictObject({
  window: z.string().describe("fiveHour, sevenDay, or sevenDay:<model> for a model's own weekly window"),
  usedPercent: z.number().min(0).max(100).nullable(),
  resetsAt: z.string().nullable(),
  readAt: z.string().nullable(),
});

/**
 * An account of the user's claude-swap by its number, as the claude-swap extension's list action gives it, without its
 * email; `held`: claude-swap starts nothing on it until the user logs in again; `threshold`: its own switch line in
 * percent (null: claude-swap's global line).
 */
export const SwapAccount = z
  .strictObject({
    number: z.int().min(1),
    alias: z.string().optional(),
    active: z.boolean(),
    disabled: z.boolean(),
    held: z.boolean(),
    threshold: z.number().min(0).max(100).nullable(),
    windows: z.array(SwapWindow),
  })
  .register(contracts, { id: "SwapAccount" });

/** claude-swap's accounts and its auto mode settings (`autoswitch.*`), read through its extension; CedarLoom keeps none. */
export const SwapAccounts = z
  .strictObject({
    accounts: z.array(SwapAccount),
    settings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  })
  .register(contracts, { id: "SwapAccounts" });

/**
 * A claude-swap command that runs only once the user approves it: the command, the CLI line that approves it, and what
 * the command needs, such as what claude-swap's menu bar service starts.
 */
export const SwapApproval = z
  .strictObject({ runs: z.string(), approve: z.string(), hint: z.string().optional() })
  .register(contracts, { id: "SwapApproval" });

/**
 * claude-swap's auto mode: its menu bar service's first line and whether that menu bar switches accounts (macOS only;
 * absent while no service is installed), and what to do next for auto mode.
 */
export const SwapService = z
  .strictObject({ service: z.string().optional(), autoSwitch: z.boolean().optional(), hint: z.string().optional() })
  .register(contracts, { id: "SwapService" });

/** claude-swap's install, which runs only once the user approves it: also its installer, source and pinned release. */
export const SwapInstall = SwapApproval.extend({
  installed: z.literal(false),
  installer: z.literal("uv"),
  source: z.url(),
  release: z.string(),
}).register(contracts, { id: "SwapInstall" });

/** claude-swap as installed: its version. */
export const SwapInstalled = z
  .strictObject({ installed: z.literal(true), version: z.string() })
  .register(contracts, { id: "SwapInstalled" });
