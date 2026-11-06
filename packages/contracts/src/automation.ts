import { z } from "zod";
import { AbsolutePath } from "./plan.ts";
import { fileFormats } from "./registry.ts";

/**
 * The three automation levels (owner, 2026-11-05). Every level runs an implementer and a fresh reviewer in separate
 * sessions; they differ in where a run waits for the owner. Fresh installs start Supervised.
 */
export const AutomationLevel = z.enum(["supervised", "checkpoint", "auto"]);
export type AutomationLevel = z.infer<typeof AutomationLevel>;

/** The automation settings format this CedarLoom writes and reads; readers refuse a newer one. */
export const AUTOMATION_SCHEMA_VERSION = 1;

/**
 * How long a `cedarloom mode` switch lasts. `running` (when unset; pending owner decision): only for the runs that are
 * running when it is made, while later runs start at their project's level. `until-off`: for every run in every project
 * until `cedarloom mode off`.
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
