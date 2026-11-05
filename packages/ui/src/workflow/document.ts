import type { HandleType, WorkflowDefinition } from "@cedarloom/contracts";
import { compatibility, NODE_TYPES, type NodeType, own } from "@cedarloom/engine/graph";

type Edge = WorkflowDefinition["edges"][number];
type From = Edge["from"];
type To = Edge["to"];
export type Position = { x: number; y: number };

/** The editor's document: the workflow as it stands, the states before it for undo and after it for redo. */
export type History = { past: WorkflowDefinition[]; present: WorkflowDefinition; future: WorkflowDefinition[] };

/** One edit of the document; each that changes the workflow is one step of undo. Positions go to `layout` only. */
export type Change =
  | { kind: "add-node"; type: string; position: Position }
  | { kind: "remove"; nodes: string[]; edges: string[] }
  | { kind: "move"; positions: Record<string, Position> }
  | { kind: "connect"; from: From; to: To }
  | { kind: "replace"; workflow: WorkflowDefinition };

// Undo steps kept; older ones are dropped.
const LIMIT = 100;
// The schema's bounds: an edit that would pass them, or leave no node, is refused.
const [MAX_NODES, MAX_EDGES] = [1000, 5000];

/** A new workflow: a manual trigger and nothing else. */
export const newWorkflow = (): WorkflowDefinition => ({
  schemaVersion: 1,
  kind: "cedarloom.workflow",
  metadata: { id: "workflow", name: "Workflow", version: "0.1.0" },
  nodes: [{ id: "start", type: "trigger.manual" }],
  edges: [],
});

export const open = (workflow: WorkflowDefinition): History => ({ past: [], present: workflow, future: [] });

const handlesOf = (workflow: WorkflowDefinition, id: string): NodeType | undefined => {
  const node = workflow.nodes.find((item) => item.id === id);
  return node === undefined ? undefined : own(NODE_TYPES, node.type);
};

// The type an edge's start names: a node's output or a workflow input.
const output = (workflow: WorkflowDefinition, from: From): HandleType | undefined =>
  "node" in from
    ? own(handlesOf(workflow, from.node)?.outputs, from.handle)?.type
    : own(workflow.inputs, from.input)?.type;

// The type an edge's end names: a node's input or a workflow output.
const input = (workflow: WorkflowDefinition, to: To): HandleType | undefined =>
  "node" in to ? own(handlesOf(workflow, to.node)?.inputs, to.handle)?.type : own(workflow.outputs, to.output)?.type;

const sameEnd = (a: From | To, b: From | To): boolean =>
  "node" in a && "node" in b ? a.node === b.node && a.handle === b.handle : JSON.stringify(a) === JSON.stringify(b);

/**
 * Whether an edge may join an output to an input: both exist, the engine's compatibility rule does not say no, and
 * the input is free (a data input or workflow output takes one edge; a control input takes each source once).
 */
export const canConnect = (workflow: WorkflowDefinition, from: From, to: To): boolean => {
  const [source, target] = [output(workflow, from), input(workflow, to)];
  if (source === undefined || target === undefined || compatibility(source, target) === "no") return false;
  if (workflow.edges.length >= MAX_EDGES) return false;
  const into = workflow.edges.filter((edge) => sameEnd(edge.to, to));
  return target === "control" ? !into.some((edge) => sameEnd(edge.from, from)) : into.length === 0;
};

/** The first of `prefix1`, `prefix2` … that no node or edge uses: ids stay unique without a counter in the file. */
const freeId = (taken: string[], prefix: string): string => {
  let n = 1;
  while (taken.includes(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
};

const withPositions = (workflow: WorkflowDefinition, positions: Record<string, Position>): WorkflowDefinition => {
  const nodes = { ...workflow.layout?.nodes };
  // Other keys of a layout entry (an editor's own) stay.
  for (const [id, position] of Object.entries(positions)) nodes[id] = { ...nodes[id], ...position };
  return { ...workflow, layout: { ...workflow.layout, nodes } };
};

const without = <T>(record: Record<string, T>, ids: Set<string>): Record<string, T> =>
  Object.fromEntries(Object.entries(record).filter(([id]) => !ids.has(id)));

/** Removes nodes with their edges, positions and policies, and the edges named. */
const remove = (workflow: WorkflowDefinition, nodes: Set<string>, edges: Set<string>): WorkflowDefinition => {
  const touches = (end: From | To): boolean => "node" in end && nodes.has(end.node);
  const next: WorkflowDefinition = {
    ...workflow,
    nodes: workflow.nodes.filter((node) => !nodes.has(node.id)),
    edges: workflow.edges.filter((edge) => !edges.has(edge.id) && !touches(edge.from) && !touches(edge.to)),
  };
  if (workflow.layout !== undefined) next.layout = { ...workflow.layout, nodes: without(workflow.layout.nodes, nodes) };
  const policies = workflow.execution?.nodes;
  if (workflow.execution !== undefined && policies !== undefined) {
    next.execution = { ...workflow.execution, nodes: without(policies, nodes) };
  }
  return next;
};

const ids = (workflow: WorkflowDefinition): string[] => [...workflow.nodes, ...workflow.edges].map((item) => item.id);

const addNode = (workflow: WorkflowDefinition, type: string, position: Position): WorkflowDefinition => {
  if (workflow.nodes.length >= MAX_NODES) return workflow;
  const id = freeId(ids(workflow), `${type.replaceAll(/[./]/g, "-")}-`);
  return withPositions({ ...workflow, nodes: [...workflow.nodes, { id, type }] }, { [id]: position });
};

const move = (workflow: WorkflowDefinition, positions: Record<string, Position>): WorkflowDefinition => {
  const known = Object.entries(positions).filter(([id]) => workflow.nodes.some((node) => node.id === id));
  return known.length === 0 ? workflow : withPositions(workflow, Object.fromEntries(known));
};

const connect = (workflow: WorkflowDefinition, from: From, to: To): WorkflowDefinition =>
  canConnect(workflow, from, to)
    ? { ...workflow, edges: [...workflow.edges, { id: freeId(ids(workflow), "e"), from, to }] }
    : workflow;

/** The workflow after a change; the same object when the change changes nothing (a refused connection, say). */
export const edit = (workflow: WorkflowDefinition, change: Change): WorkflowDefinition => {
  if (change.kind === "add-node") return addNode(workflow, change.type, change.position);
  if (change.kind === "move") return move(workflow, change.positions);
  if (change.kind === "connect") return connect(workflow, change.from, change.to);
  if (change.kind === "replace") return change.workflow;
  const [nodes, edges] = [new Set(change.nodes), new Set(change.edges)];
  const left = workflow.nodes.filter((item) => !nodes.has(item.id)).length;
  return nodes.size + edges.size === 0 || left === 0 ? workflow : remove(workflow, nodes, edges);
};

/** Applies a change as one undo step; a change that changes nothing adds no step. */
export const apply = (history: History, change: Change): History => {
  const present = edit(history.present, change);
  if (present === history.present) return history;
  return { past: [...history.past, history.present].slice(-LIMIT), present, future: [] };
};

export const undo = (history: History): History => {
  const previous = history.past.at(-1);
  if (previous === undefined) return history;
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
};

export const redo = (history: History): History => {
  const [next, ...future] = history.future;
  if (next === undefined) return history;
  return { past: [...history.past, history.present].slice(-LIMIT), present: next, future };
};
