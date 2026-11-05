import type { HandleType, WorkflowDefinition } from "@cedarloom/contracts";
import { NODE_TYPES, own } from "@cedarloom/engine/graph";
import type { Connection, Edge, Node } from "@xyflow/react";
import type { Position } from "./document.ts";

type WorkflowEdge = WorkflowDefinition["edges"][number];

/** A handle as a canvas node shows it. */
type HandleView = { name: string; type: HandleType };

/** What a canvas node shows: its workflow node type and its handles, inputs on one side, outputs on the other. */
export type CardData = { type: string; inputs: HandleView[]; outputs: HandleView[] };

// The workflow's own inputs and outputs are two canvas nodes at its edges; no node id can start with "@".
export const INPUTS = "@inputs";
export const OUTPUTS = "@outputs";

const [STEP, ROW] = [240, 160];

const views = (handles: Readonly<Record<string, { type: HandleType }>> | undefined): HandleView[] =>
  Object.entries(handles ?? {}).map(([name, { type }]) => ({ name, type }));

const card = (id: string, data: CardData, position: Position): Node<CardData> => ({ id, type: "card", position, data });

/**
 * The canvas of a workflow: a node per workflow node at its `layout` position, nodes without one in a row below the
 * placed ones, and an edge per workflow edge. Nothing else of the canvas is kept: the workflow is the only source.
 */
export const project = (workflow: WorkflowDefinition): { nodes: Node<CardData>[]; edges: Edge[] } => {
  const placed = workflow.layout?.nodes ?? {};
  const ys = workflow.nodes.flatMap((node) => own(placed, node.id)?.y ?? []);
  const below = Math.max(-ROW, ...ys) + ROW;
  let unplaced = 0;
  const nodes = workflow.nodes.map((node) => {
    const at = own(placed, node.id);
    const type = own(NODE_TYPES, node.type);
    const data = { type: node.type, inputs: views(type?.inputs), outputs: views(type?.outputs) };
    return card(node.id, data, at === undefined ? { x: STEP * unplaced++, y: below } : { x: at.x, y: at.y });
  });
  const xs = nodes.map((node) => node.position.x);
  const [left, right] = [Math.min(0, ...xs) - STEP, Math.max(0, ...xs) + STEP];
  const inputs = views(workflow.inputs);
  const outputs = views(workflow.outputs);
  const boundary = [
    ...(inputs.length > 0 ? [card(INPUTS, { type: "inputs", inputs: [], outputs: inputs }, { x: left, y: 0 })] : []),
    ...(outputs.length > 0
      ? [card(OUTPUTS, { type: "outputs", inputs: outputs, outputs: [] }, { x: right, y: 0 })]
      : []),
  ];
  return { nodes: [...boundary, ...nodes], edges: workflow.edges.map(canvasEdge) };
};

const canvasEdge = ({ id, from, to }: WorkflowEdge): Edge => ({
  id,
  source: "node" in from ? from.node : INPUTS,
  sourceHandle: "node" in from ? from.handle : from.input,
  target: "node" in to ? to.node : OUTPUTS,
  targetHandle: "node" in to ? to.handle : to.output,
});

/** The edge ends a canvas connection names, or undefined when it names no handle. */
export const endsOf = ({
  source,
  sourceHandle,
  target,
  targetHandle,
}: Connection): Pick<WorkflowEdge, "from" | "to"> | undefined => {
  if (sourceHandle === null || targetHandle === null) return undefined;
  return {
    from: source === INPUTS ? { input: sourceHandle } : { node: source, handle: sourceHandle },
    to: target === OUTPUTS ? { output: targetHandle } : { node: target, handle: targetHandle },
  };
};
