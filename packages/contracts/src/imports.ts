import { z } from "zod";
import { Commit, GitRef, GitUrl } from "./extension.ts";
import { AbsolutePath } from "./plan.ts";
import { contracts } from "./registry.ts";
import { License, semver, WorkflowId } from "./workflow.ts";

const NodeIds = z.array(z.string());

/**
 * What an import would do, shown before the plan (P6 a: nothing imported updates by itself): each workflow with its
 * status against the store, every line that runs or writes, and the licenses. The same model for the CLI, the API and
 * the UI.
 */
export const ImportReview = z
  .strictObject({
    source: z.union([
      z.strictObject({ folder: AbsolutePath }),
      z.strictObject({ git: GitUrl, ref: GitRef, commit: Commit }),
    ]),
    units: z.array(
      z.strictObject({
        id: WorkflowId,
        /**
         * new: not stored; same: stored as it is; update: stored as its last import left it; conflict: stored and edited
         * here since (or never imported), which an import never replaces.
         */
        status: z.enum(["new", "same", "update", "conflict"]),
        version: semver,
        stored: semver.nullable().describe("The stored version; null when there is none"),
        license: License.nullable().describe("Its own license, else the export's; null: none stated"),
        changes: z
          .strictObject({ added: NodeIds, removed: NodeIds, changed: NodeIds })
          .describe("Node ids against the stored version"),
      }),
    ),
    risks: z.array(
      z.strictObject({
        workflow: WorkflowId,
        node: z.string(),
        kind: z.enum(["schedule", "precheck", "command", "agent", "approval", "workflow"]),
        text: z.string().describe("The command, task, schedule, approval message or workflow in full"),
      }),
    ),
  })
  .register(contracts, { id: "ImportReview" });
export type ImportReview = z.infer<typeof ImportReview>;
