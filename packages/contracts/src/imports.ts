import { z } from "zod";
import { Capabilities, Commit, ExtensionId, FolderDigest, GitRef, GitUrl, PortablePath } from "./extension.ts";
import { AbsolutePath } from "./plan.ts";
import { contracts } from "./registry.ts";
import { License, semver, WorkflowId } from "./workflow.ts";

const NodeIds = z.array(z.string());

/**
 * What an import would do, shown before the plan (P6 a: nothing imported updates by itself): each workflow with its
 * status against the store, every line that runs or writes, the extensions its lock pins, and the licenses. The same
 * model for the CLI, the API and the UI.
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
        kind: z.enum(["schedule", "precheck", "command", "agent", "write", "workflow", "extension"]),
        text: z.string().describe("The command, task, schedule, path or node type in full"),
      }),
    ),
    extensions: z.array(
      z.strictObject({
        id: ExtensionId,
        version: semver,
        git: GitUrl,
        commit: Commit,
        path: PortablePath.optional(),
        digest: FolderDigest,
        /**
         * verified: the files at the commit have the lock's digest; mismatch: other files, which refuses the import;
         * unreachable: not fetched.
         */
        status: z.enum(["verified", "mismatch", "unreachable"]),
        installed: z.boolean().describe("Installed here at this commit and digest; the import installs none"),
        capabilities: Capabilities.nullable().describe(
          "What its manifest at the commit asks for; null when not verified, or its manifest does not read or names another id or version",
        ),
      }),
    ),
  })
  .register(contracts, { id: "ImportReview" });
export type ImportReview = z.infer<typeof ImportReview>;
