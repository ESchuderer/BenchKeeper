import type { WorkflowDefinition } from "@cedarloom/contracts";
import { NODE_TYPES, own } from "@cedarloom/engine/graph";
import type { ElkExtendedEdge, ElkNode, ElkPort } from "elkjs/lib/elk-api.js";
import { type Position, uniqueNodes } from "./document.ts";

/** What auto layout needs of ELK: a layout of a graph. */
export type Engine = { layout: (graph: ElkNode) => Promise<ElkNode> };

/** A node's size on the canvas, as React Flow measured it. */
export type Size = { width: number; height: number };

// Before a node is measured: its title and one row per handle, as the node card draws them.
const estimate = (type: string): Size => {
  const handles = own(NODE_TYPES, type);
  const rows = Object.keys(handles?.inputs ?? {}).length + Object.keys(handles?.outputs ?? {}).length;
  return { width: 200, height: 56 + 26 * rows };
};

const portId = (node: string, side: "in" | "out", handle: string): string => `${node}\u0000${side}\u0000${handle}`;

const ports = (node: string, type: string): ElkPort[] => {
  const handles = own(NODE_TYPES, type);
  const port = (side: "in" | "out") => (handle: string) => ({
    id: portId(node, side, handle),
    layoutOptions: { "elk.port.side": side === "in" ? "WEST" : "EAST" },
  });
  return [
    ...Object.keys(handles?.inputs ?? {}).map(port("in")),
    ...Object.keys(handles?.outputs ?? {}).map(port("out")),
  ];
};

// A port per handle (inputs west, outputs east, in card order); the workflow's own inputs and outputs sit at the edges.
export const elkGraph = (workflow: WorkflowDefinition, sizes: Readonly<Record<string, Size>>): ElkNode => {
  const children = uniqueNodes(workflow).map((node) => ({
    id: node.id,
    ...(own(sizes, node.id) ?? estimate(node.type)),
    layoutOptions: { "elk.portConstraints": "FIXED_ORDER" },
    ports: ports(node.id, node.type),
  }));
  const known = new Set(children.flatMap((child) => child.ports.map((port) => port.id)));
  const edges = workflow.edges.flatMap((edge): ElkExtendedEdge[] => {
    if (!("node" in edge.from) || !("node" in edge.to)) return [];
    const [source, target] = [
      portId(edge.from.node, "out", edge.from.handle),
      portId(edge.to.node, "in", edge.to.handle),
    ];
    return known.has(source) && known.has(target) ? [{ id: edge.id, sources: [source], targets: [target] }] : [];
  });
  return {
    id: "workflow",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": "40",
      "elk.layered.spacing.nodeNodeBetweenLayers": "80",
    },
    children,
    edges,
  };
};

// ELK's layered layout, left to right, in a Web Worker in the browser; the result is one move, so one undo step.
export const autoLayout = async (
  elk: Engine,
  workflow: WorkflowDefinition,
  sizes: Readonly<Record<string, Size>>,
): Promise<Record<string, Position>> => {
  const laid = await elk.layout(elkGraph(workflow, sizes));
  return Object.fromEntries(
    (laid.children ?? []).map((child) => [child.id, { x: Math.round(child.x ?? 0), y: Math.round(child.y ?? 0) }]),
  );
};
