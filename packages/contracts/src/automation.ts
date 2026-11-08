import { z } from "zod";
import { AbsolutePath } from "./plan.ts";
import { fileFormats } from "./registry.ts";

/**
 * The three automation levels (owner, 2026-11-05). Every level runs an implementer and a fresh reviewer in separate
 * sessions; they differ in where a run waits for the owner, at three gates (before the implementation, after the
 * reviewer's verdict, before a merge): Supervised at all three, Checkpoint before a merge only, Auto at none (it merges
 * when both sides agree). At every level a step waits that touches a release (merging a release pull request is one), a
 * publish, a deploy, a repository's creation or settings, a secret or anything public, and so does a command of a
 * workflow version the owner has not approved in the project yet (owner, 2026-11-07). Supervised sends every question
 * to the owner; Checkpoint and Auto send the owner's questions (taste, scope, money, legal, risk, anything public or
 * hard to undo) and take a safe default for the others, flagged for review. A project's level wins over the default,
 * and fresh installs start Supervised.
 */
export const AutomationLevel = z.enum(["supervised", "checkpoint", "auto"]);
export type AutomationLevel = z.infer<typeof AutomationLevel>;

/** The automation settings format this CedarLoom writes and reads; readers refuse a newer one. */
export const AUTOMATION_SCHEMA_VERSION = 1;

/**
 * How long a `cedarloom mode` switch lasts. `running` (when unset; owner decision, 2026-11-06): only for the runs
 * that are running when it is made, while later runs start at their project's level. `until-off`: for every run in
 * every project until `cedarloom mode off`.
 */
export const ModeScope = z.enum(["running", "until-off"]);
export type ModeScope = z.infer<typeof ModeScope>;

/** The level of each project, by the real path of its folder, and the default for every other project. */
export const AutomationSettings = z
  .strictObject({
    schemaVersion: z.literal(AUTOMATION_SCHEMA_VERSION),
    default: AutomationLevel,
    projects: z.record(AbsolutePath, AutomationLevel),
    modeScope: ModeScope.optional(),
  })
  .register(fileFormats, { id: "AutomationSettings" });
export type AutomationSettings = z.infer<typeof AutomationSettings>;

/** A switch of the level for running work, as the ledger keeps it; level null ends the switch. */
export const ModeSwitch = z.strictObject({
  at: z.iso.datetime({ precision: 3 }),
  level: AutomationLevel.nullable(),
});
export type ModeSwitch = z.infer<typeof ModeSwitch>;
