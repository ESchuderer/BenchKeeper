import type { AutomationLevel, AutomationSettings } from "@cedarloom/contracts";

/** The points where a task's run may wait for the owner's approval. */
export type ApprovalGate = "before-implementation" | "after-verdict" | "before-merge";

/**
 * What stays with the owner at every level (owner, 2026-11-05): a release, a publish, a deploy, a repository's creation
 * or settings, a secret, and anything public. Merging a release pull request is the release.
 */
export type OwnerOnly = "release" | "publish" | "deploy" | "repository" | "settings" | "secret" | "public";

// Supervised waits at every gate; Checkpoint only before a merge, which the owner approves with one click, batchable;
// Auto merges on agreement of the implementer and the fresh reviewer.
const WAITS: Readonly<Record<AutomationLevel, readonly ApprovalGate[]>> = {
  supervised: ["before-implementation", "after-verdict", "before-merge"],
  checkpoint: ["before-merge"],
  auto: [],
};

/**
 * Whether a run at `level` waits for the owner at `gate`. A step that touches anything in `ownerOnly` waits at every gate
 * of every level, Auto included; the input is required, so a caller cannot leave the list out.
 */
export const waitsForOwner = (level: AutomationLevel, gate: ApprovalGate, ownerOnly: readonly OwnerOnly[]): boolean =>
  ownerOnly.length > 0 || WAITS[level].includes(gate);

/**
 * A worker's question: the owner's (taste, scope, money, legal, risk, anything public or hard to undo) or a fact or a
 * reversible detail.
 */
export type Question = "owner" | "fact";

/**
 * What a question does to its task: `park` sends it to the owner and parks only that task, while the worker takes the
 * next one; `default` takes the safe default and flags it for later review. Supervised parks every question.
 */
export const routeQuestion = (level: AutomationLevel, question: Question): "park" | "default" =>
  level === "supervised" || question === "owner" ? "park" : "default";

/**
 * The level that applies at a gate: the switch for running work, else the project's level, else the default; with no
 * settings at all, as on a fresh install, Supervised. The launcher reads it at each gate, so a switch takes effect at
 * the next gate and never in the middle of a step.
 */
export const levelAt = (
  settings: AutomationSettings | null,
  project: string,
  running: AutomationLevel | null,
): AutomationLevel => {
  if (running !== null) return running;
  if (settings === null) return "supervised";
  // Own entries only: a folder named like an inherited property is no project.
  return new Map(Object.entries(settings.projects)).get(project) ?? settings.default;
};
