import type { HandleType } from "@cedarloom/contracts";

/** Whether an edge may join two handles: `unchecked` passes a `json` value on to a typed input, checked when it runs. */
export type Compatibility = "yes" | "unchecked" | "no";

/** The one compatibility rule of typed handles, for the editor while a user drags an edge and for the CLI validator. */
export const compatibility = (from: HandleType, to: HandleType): Compatibility => {
  if (from === to) return "yes";
  if (from === "control" || to === "control") return "no";
  if (to === "json") return "yes";
  return from === "json" ? "unchecked" : "no";
};

/**
 * A handle of a node type; a `required` data input needs an edge. Control inputs take many edges, data inputs one.
 * Of a node's `exclusive` outputs exactly one fires; the nodes behind the others are skipped, and so on downstream.
 */
type Handle = { type: HandleType; required?: true; exclusive?: true };
export type NodeType = { inputs: Record<string, Handle>; outputs: Record<string, Handle> };

const control: Handle = { type: "control" };
const branch: Handle = { type: "control", exclusive: true };
const text: Handle = { type: "string" };
const run = { run: control };
// `failed` routes a failure along an edge instead of the run's failure policy.
const ended = { done: branch, failed: branch };

/** The node types of workflow schema version 1, with their handles. Their configuration and execution come later. */
export const NODE_TYPES: Readonly<Record<string, NodeType>> = {
  "trigger.manual": { inputs: {}, outputs: { start: control } },
  "trigger.schedule": { inputs: {}, outputs: { start: control } },
  "agent.run": { inputs: { ...run, context: text }, outputs: { ...ended, result: text } },
  "command.run": { inputs: run, outputs: { ...ended, stdout: text, exitCode: { type: "number" } } },
  "file.read": { inputs: run, outputs: { ...ended, content: text } },
  "file.write": { inputs: { ...run, content: text }, outputs: ended },
  condition: {
    inputs: { ...run, value: { type: "boolean", required: true } },
    outputs: { true: branch, false: branch },
  },
  join: { inputs: { branches: control }, outputs: { done: control } },
  "human.approval": { inputs: run, outputs: { approved: branch, rejected: branch } },
  "workflow.run": { inputs: run, outputs: ended },
};
