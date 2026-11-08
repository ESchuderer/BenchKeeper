import { MAX_WORKFLOW_EDGES, MAX_WORKFLOW_NODES, type WorkflowDefinition } from "@cedarloom/contracts";
import { compatibility, endType, NODE_TYPES, own } from "@cedarloom/engine/graph";

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

/** A new workflow: a manual trigger, placed, so that nodes added next to it never move it. */
export const newWorkflow = (): WorkflowDefinition => ({
  schemaVersion: 1,
  kind: "cedarloom.workflow",
  metadata: { id: "workflow", name: "Workflow", version: "0.1.0" },
  nodes: [{ id: "start", type: "trigger.manual" }],
  edges: [],
  layout: { nodes: { start: { x: 0, y: 0 } } },
});

export const open = (workflow: WorkflowDefinition): History => ({ past: [], present: workflow, future: [] });

/** The nodes, the first of each id: a later node with an id taken (the validator reports it) is left out. */
export const uniqueNodes = (workflow: WorkflowDefinition): WorkflowDefinition["nodes"] => {
  const seen = new Set<string>();
  return workflow.nodes.filter((node) => {
    if (seen.has(node.id)) return false;
    seen.add(node.id);
    return true;
  });
};

const sameEnd = (a: From | To, b: From | To): boolean =>
  "node" in a && "node" in b ? a.node === b.node && a.handle === b.handle : JSON.stringify(a) === JSON.stringify(b);

/** Whether a path of edges leads from node `start` to node `goal` (a node leads to itself). */
const leads = (workflow: WorkflowDefinition, start: string, goal: string): boolean => {
  const next = new Map<string, string[]>();
  for (const { from, to } of workflow.edges) {
    if ("node" in from && "node" in to) next.set(from.node, [...(next.get(from.node) ?? []), to.node]);
  }
  const seen = new Set([start]);
  for (const id of seen) {
    for (const to of next.get(id) ?? []) seen.add(to);
  }
  return seen.has(goal);
};

// The input must be free (one edge into data, each source once into control); two exclusive outputs into one warn.
export const canConnect = (workflow: WorkflowDefinition, from: From, to: To): boolean => {
  const [source, target] = [endType(workflow, from, "from"), endType(workflow, to, "to")];
  if (source === undefined || target === undefined || compatibility(source, target) === "no") return false;
  if (workflow.edges.length >= MAX_WORKFLOW_EDGES) return false;
  if ("node" in from && "node" in to && leads(workflow, to.node, from.node)) return false;
  const into = workflow.edges.filter((edge) => sameEnd(edge.to, to));
  return target === "control" ? !into.some((edge) => sameEnd(edge.from, from)) : into.length === 0;
};

// The first unused `prefix<n>`, so a new node never takes over an entry left in the layout or execution section.
const freeId = (workflow: WorkflowDefinition, prefix: string): string => {
  const taken = new Set([
    ...[...workflow.nodes, ...workflow.edges].map((item) => item.id),
    ...Object.keys(workflow.layout?.nodes ?? {}),
    ...Object.keys(workflow.execution?.nodes ?? {}),
  ]);
  let n = 1;
  while (taken.has(`${prefix}${n}`)) n += 1;
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

// The schema takes finite numbers only: NaN or Infinity would make the file unwritable.
const finite = ({ x, y }: Position): boolean => Number.isFinite(x) && Number.isFinite(y);

const addNode = (workflow: WorkflowDefinition, type: string, position: Position): WorkflowDefinition => {
  if (workflow.nodes.length >= MAX_WORKFLOW_NODES || own(NODE_TYPES, type) === undefined || !finite(position))
    return workflow;
  const id = freeId(workflow, `${type.replaceAll(/[./]/g, "-")}-`);
  return withPositions({ ...workflow, nodes: [...workflow.nodes, { id, type }] }, { [id]: position });
};

// Moves of nodes that exist to where they are not yet; none of them: no change, so no empty undo step.
const move = (workflow: WorkflowDefinition, positions: Record<string, Position>): WorkflowDefinition => {
  const placed = workflow.layout?.nodes ?? {};
  const moved = Object.entries(positions).filter(([id, position]) => {
    const at = own(placed, id);
    const changed = at?.x !== position.x || at.y !== position.y;
    return workflow.nodes.some((node) => node.id === id) && finite(position) && changed;
  });
  return moved.length === 0 ? workflow : withPositions(workflow, Object.fromEntries(moved));
};

const connect = (workflow: WorkflowDefinition, from: From, to: To): WorkflowDefinition =>
  canConnect(workflow, from, to)
    ? { ...workflow, edges: [...workflow.edges, { id: freeId(workflow, "e"), from, to }] }
    : workflow;

// A workflow the editor may hold: nodes within the schema's bounds and positions it can write.
const fits = (workflow: WorkflowDefinition): boolean =>
  workflow.nodes.length > 0 &&
  workflow.nodes.length <= MAX_WORKFLOW_NODES &&
  workflow.edges.length <= MAX_WORKFLOW_EDGES &&
  Object.values(workflow.layout?.nodes ?? {}).every(finite);

/** The workflow after a change; the same object when the change changes nothing (a refused connection, say). */
export const edit = (workflow: WorkflowDefinition, change: Change): WorkflowDefinition => {
  if (change.kind === "add-node") return addNode(workflow, change.type, change.position);
  if (change.kind === "move") return move(workflow, change.positions);
  if (change.kind === "connect") return connect(workflow, change.from, change.to);
  if (change.kind === "replace") return fits(change.workflow) ? change.workflow : workflow;
  const next = remove(workflow, new Set(change.nodes), new Set(change.edges));
  const same = next.nodes.length === workflow.nodes.length && next.edges.length === workflow.edges.length;
  return same || next.nodes.length === 0 ? workflow : next;
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
