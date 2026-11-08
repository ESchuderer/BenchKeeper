import type { HandleType, WorkflowDefinition } from "@cedarloom/contracts";

/** Whether an edge may join two handles: `unchecked` passes a `json` value on to a typed input, unknown to a validator. */
export type Compatibility = "yes" | "unchecked" | "no";

/** The one compatibility rule of typed handles, for the editor while a user drags an edge and for the CLI validator. */
export const compatibility = (from: HandleType, to: HandleType): Compatibility => {
  if (from === to) return "yes";
  if (from === "control" || to === "control") return "no";
  if (to === "json") return "yes";
  return from === "json" ? "unchecked" : "no";
};

// A required data input needs an edge; control inputs take many, data inputs one; one exclusive output fires.
type Handle = { type: HandleType; required?: true; exclusive?: true };
export type NodeType = { inputs: Record<string, Handle>; outputs: Record<string, Handle> };

const control: Handle = { type: "control" };
const branch: Handle = { type: "control", exclusive: true };
const text: Handle = { type: "string" };
const run = { run: control };
// `failed` routes a failure along an edge instead of the run's failure policy.
const ended = { done: branch, failed: branch };

/** A record's own entry: a node type, handle or input named like an Object property (`constructor`) is none. */
export const own = <T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined =>
  record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;

/**
 * Node types that wait until after 0.1.0 (owner, 2026-11-06): schedules and child workflows. The validator refuses
 * them, and the editor does not offer them.
 */
export const LATER_TYPES: ReadonlySet<string> = new Set(["trigger.schedule", "workflow.run"]);

/** The node types of workflow schema version 1, with their handles; the contracts' `NODE_CONFIGS` configure them. */
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

type End = WorkflowDefinition["edges"][number]["from"] | WorkflowDefinition["edges"][number]["to"];

type Field = { input: string } | { output: string };

// A workflow input starts edges only, a workflow output ends them only.
const fieldType = (workflow: Pick<WorkflowDefinition, "inputs" | "outputs">, end: Field, side: "from" | "to") => {
  if ("input" in end) return side === "from" ? own(workflow.inputs, end.input)?.type : undefined;
  return side === "to" ? own(workflow.outputs, end.output)?.type : undefined;
};

/**
 * The type an edge end names: at the start of an edge a node's output or a workflow input, at its end a node's input
 * or a workflow output; undefined when the end names none. The editor checks connections with it.
 */
export const endType = (
  workflow: Pick<WorkflowDefinition, "nodes" | "inputs" | "outputs">,
  end: End,
  side: "from" | "to",
): HandleType | undefined => {
  if (!("node" in end)) return fieldType(workflow, end, side);
  const node = workflow.nodes.find((item) => item.id === end.node);
  const type = node === undefined ? undefined : own(NODE_TYPES, node.type);
  return own(side === "from" ? type?.outputs : type?.inputs, end.handle)?.type;
};
