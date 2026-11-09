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
 * and fresh installs start Supervised. These are the owner's rules for the plugin CedarLoom builds for the agent tools;
 * CedarLoom itself runs no workflow and enforces none of them.
 */
export const AutomationLevel = z.enum(["supervised", "checkpoint", "auto"]);

/** The directory marketplace through which Claude Code and Codex load the workflow packages CedarLoom installs. */
export const WORKFLOW_MARKETPLACE = "cedarloom-workflows";
export type AutomationLevel = z.infer<typeof AutomationLevel>;

/** The automation settings format this CedarLoom writes and reads; readers refuse a newer one. */
export const AUTOMATION_SCHEMA_VERSION = 1;

/** The level of each project, by the real path of its folder, and the default for every other project. */
export const AutomationSettings = z
  .strictObject({
    schemaVersion: z.literal(AUTOMATION_SCHEMA_VERSION),
    default: AutomationLevel,
    projects: z.record(AbsolutePath, AutomationLevel),
  })
  .register(fileFormats, { id: "AutomationSettings" });
export type AutomationSettings = z.infer<typeof AutomationSettings>;
