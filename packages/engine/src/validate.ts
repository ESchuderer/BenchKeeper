import {
  type Finding,
  type HandleType,
  isExtensionType,
  NODE_CONFIGS,
  type WorkflowDefinition,
} from "@cedarloom/contracts";
import { type ActionCatalog, compatibility, LATER_TYPES, NODE_TYPES, type NodeType, nodeType, own } from "./graph.ts";

type Edge = WorkflowDefinition["edges"][number];
type End = Edge["from"] | Edge["to"];
type Resolved = HandleType | Finding | null;
type Graph = {
  workflow: WorkflowDefinition;
  actions: ActionCatalog;
  /** One node and one edge per id, the first of duplicates (a finding of its own), in document order. */
  nodes: WorkflowDefinition["nodes"];
  edges: Edge[];
  types: Map<string, NodeType | undefined>;
  /** Each edge with the types of its ends, a finding for an end that names nothing, or null for an unknown node type. */
  resolved: { edge: Edge; from: Resolved; to: Resolved }[];
  /** Node to node links of the edges without a finding of their own, for the cycle check. */
  next: Map<string, string[]>;
  /**
   * Node to node links of the edges that can order a node to run: into a control input, or into a handle that did not
   * resolve, so one bad edge hides no node. An edge into a data input starts nothing.
   */
  reach: Map<string, string[]>;
};

const duplicates = ({ workflow }: Graph): Finding[] =>
  (["node", "edge"] as const).flatMap((kind) => {
    const ids = (kind === "node" ? workflow.nodes : workflow.edges).map((item) => item.id);
    const twice = ids.filter((id, index) => ids.indexOf(id) !== index);
    return [...new Set(twice)].map((id): Finding => ({ code: "workflow.duplicate-id", params: { kind, id } }));
  });

const isTrigger = (node: { type: string }): boolean => node.type.startsWith("trigger.");

type Node = WorkflowDefinition["nodes"][number];

/** The issues of a node's `with` (checked as `{}` when absent), or a finding when its type is unknown. */
const configIssues = (node: Node, actions: ActionCatalog): { path: string; code: string }[] | Finding => {
  // An extension action the catalog lacks is not installed: the workflow is fine, but cannot run here.
  if (isExtensionType(node.type)) {
    const action = actions.get(node.type);
    return (
      action?.check(node.with ?? {}) ?? {
        code: "workflow.extension-missing",
        params: { node: node.id, type: node.type },
      }
    );
  }
  const schema = own(NODE_CONFIGS, node.type);
  // NODE_CONFIGS names the same types as NODE_TYPES (a test checks it).
  if (own(NODE_TYPES, node.type) === undefined || schema === undefined) {
    return { code: "workflow.unknown-node-type", params: { node: node.id, type: node.type } };
  }
  const config = schema.safeParse(node.with ?? {});
  return config.success ? [] : config.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code }));
};

const nodeFindings = ({ nodes, actions }: Graph): Finding[] => {
  const triggers = nodes.filter(isTrigger).length;
  return [
    ...(triggers === 1 ? [] : [{ code: "workflow.trigger-count", params: { count: triggers } } as const]),
    ...nodes.flatMap((node): Finding[] => {
      if (LATER_TYPES.has(node.type))
        return [{ code: "run.node-unsupported", params: { node: node.id, type: node.type } }];
      const issues = configIssues(node, actions);
      if (!Array.isArray(issues)) return [issues];
      return issues.length === 0 ? [] : [{ code: "workflow.invalid-config", params: { node: node.id, issues } }];
    }),
  ];
};

/** The type of the workflow input or output an edge end names, or a finding when the workflow declares none. */
const field = (
  workflow: WorkflowDefinition,
  edge: string,
  end: "from" | "to",
  at: { input: string } | { output: string },
): HandleType | Finding => {
  const [ref, fields] = "input" in at ? [at.input, workflow.inputs] : [at.output, workflow.outputs];
  return own(fields, ref)?.type ?? { code: "workflow.dangling-edge", params: { edge, end, ref } };
};

type Lookup = Pick<Graph, "workflow" | "types">;

const resolve = ({ workflow, types }: Lookup, edge: string, end: "from" | "to", at: End): Resolved => {
  if (!("node" in at)) return field(workflow, edge, end, at);
  if (!types.has(at.node)) return { code: "workflow.dangling-edge", params: { edge, end, ref: at.node } };
  const type = types.get(at.node);
  if (type === undefined) return null;
  const handle = own(end === "from" ? type.outputs : type.inputs, at.handle);
  return handle?.type ?? { code: "workflow.unknown-handle", params: { edge, end, handle: `${at.node}.${at.handle}` } };
};

const edgeFindings = ({ resolved }: Graph): Finding[] =>
  resolved.flatMap(({ edge, from, to }): Finding[] => {
    if (typeof from !== "string" || typeof to !== "string") {
      return [from, to].filter((item): item is Finding => typeof item === "object" && item !== null);
    }
    const params = { edge: edge.id, from, to };
    const verdict = compatibility(from, to);
    if (verdict === "yes") return [];
    return [{ code: verdict === "no" ? "workflow.incompatible-handles" : "workflow.unchecked-handles", params }];
  });

const target = (node: string | null, handle: string): string => `${node ?? ""}\0${handle}`;

// The edges of a graph without twins: the first per output and input they join, one key lookup each.
const distinct = (edges: Edge[]): Edge[] => [
  ...new Map(edges.toReversed().map((edge) => [pairOf(edge), edge])).values(),
];

// A node end by its fields in a fixed order; a workflow input or output end has one key, so its text is fixed too.
const endKey = (end: End): string => JSON.stringify("node" in end ? [end.node, end.handle] : end);

const pairOf = ({ from, to }: Edge): string => JSON.stringify([endKey(from), endKey(to)]);

/** An edge that joins the same output to the same input as an earlier one adds nothing: a join it feeds gains no branch. */
const twins = ({ edges }: Graph): Finding[] => {
  const first = new Map<string, string>();
  return edges.flatMap((edge): Finding[] => {
    const of = first.get(pairOf(edge));
    if (of === undefined) first.set(pairOf(edge), edge.id);
    return of === undefined ? [] : [{ code: "workflow.duplicate-edge", params: { edge: edge.id, of } }];
  });
};

/** One edge into each data input and workflow output (none for an optional input), two or more into a join. */
const sourceFindings = ({ workflow, nodes, edges, types }: Graph): Finding[] => {
  const counts = new Map<string, number>();
  // Twins count once, so a twin is one finding (duplicate-edge), not also many-sources.
  for (const { to } of distinct(edges)) {
    const key = "output" in to ? target(null, to.output) : target(to.node, to.handle);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const count = (node: string | null, handle: string): number => counts.get(target(node, handle)) ?? 0;
  const joins = nodes
    .filter((node) => node.type === "join" && count(node.id, "branches") < 2)
    .map(
      (node): Finding => ({
        code: "workflow.join-branches",
        params: { node: node.id, count: count(node.id, "branches") },
      }),
    );
  const data = [
    ...Object.keys(workflow.outputs ?? {}).map((handle) => ({ node: null, handle, required: true })),
    ...nodes.flatMap((node) =>
      Object.entries(types.get(node.id)?.inputs ?? {})
        .filter(([, spec]) => spec.type !== "control")
        .map(([handle, spec]) => ({ node: node.id, handle, required: spec.required === true })),
    ),
  ];
  return [
    ...joins,
    ...data.flatMap(({ node, handle, required }): Finding[] => {
      const sources = count(node, handle);
      if (sources > 1) return [{ code: "workflow.many-sources", params: { node, handle, count: sources } }];
      return sources === 0 && required ? [{ code: "workflow.missing-source", params: { node, handle } }] : [];
    }),
  ];
};

/**
 * The first cycle of edges between nodes, in document order, or none: the normal path is a DAG. The recursion is as
 * deep as the longest path, which the schema's 1,000 nodes bound.
 */
const cycle = ({ nodes, next }: Graph): Finding[] => {
  const state = new Map<string, "open" | "done">();
  const visit = (node: string, path: string[]): string[] | undefined => {
    // The path ends with this node a second time; the cycle is the stretch from its first visit.
    if (state.get(node) === "open") return path.slice(path.indexOf(node), -1);
    if (state.get(node) === "done") return undefined;
    state.set(node, "open");
    const found = (next.get(node) ?? []).map((to) => visit(to, [...path, to])).find((item) => item !== undefined);
    state.set(node, "done");
    return found;
  };
  const found = nodes.map((node) => visit(node.id, [node.id])).find((item) => item !== undefined);
  return found === undefined ? [] : [{ code: "workflow.cycle", params: { nodes: found } }];
};

/**
 * Nodes of a known type that no path of control edges from the trigger reaches: they would never run, since a node
 * runs only once a control edge into it fired. Data alone (from a workflow input or a node) starts nothing.
 */
const unreachable = ({ nodes, types, reach }: Graph): Finding[] => {
  const triggers = nodes.filter(isTrigger);
  if (triggers.length !== 1) return [];
  const seen = new Set(triggers.map((node) => node.id));
  const queue = [...seen];
  for (const node of queue) {
    for (const to of (reach.get(node) ?? []).filter((item) => !seen.has(item))) {
      seen.add(to);
      queue.push(to);
    }
  }
  return nodes
    .filter((node) => !seen.has(node.id) && types.get(node.id) !== undefined)
    .map((node): Finding => ({ code: "workflow.unreachable", params: { node: node.id } }));
};

/**
 * A28: a report run, as a schedule starts, has no node that may write a file: no file.write, and no workflow.run, whose
 * child the validator cannot see. No extension action either, which may write through the host or change other systems
 * (P9 b).
 */
export const reportOnly = (nodes: WorkflowDefinition["nodes"]): Finding[] =>
  nodes.flatMap((node): Finding[] => {
    if (isExtensionType(node.type)) return [{ code: "workflow.report-only-extension", params: { node: node.id } }];
    const writes = node.type === "file.write" || node.type === "workflow.run";
    return writes ? [{ code: "workflow.report-only-write", params: { node: node.id } }] : [];
  });

const scheduledReports = ({ nodes }: Graph): Finding[] =>
  nodes.some((node) => node.type === "trigger.schedule") ? reportOnly(nodes) : [];

const strays = ({ workflow, types }: Graph): Finding[] =>
  (["execution", "layout"] as const).flatMap((section) =>
    Object.keys(workflow[section]?.nodes ?? {})
      .filter((node) => !types.has(node))
      .map((node): Finding => ({ code: "workflow.stray-entry", params: { section, node } })),
  );

type Item = Graph["resolved"][number];

/**
 * A control input fed by two exclusive outputs of one node (true and false, done and failed, approved and rejected)
 * waits for an output that never fires, so its node is always skipped; a join with policy `any` merges them.
 */
const exclusiveSources = ({ nodes, types, resolved }: Graph): Finding[] => {
  const merges = new Set(
    nodes.filter((node) => node.type === "join" && node.with?.["policy"] === "any").map((n) => n.id),
  );
  const fed = new Map<string, { node: string; handle: string; from: string; outputs: Set<string> }>();
  for (const { edge, to: type } of resolved) {
    const { from, to } = edge;
    if (!("node" in from) || !("node" in to) || type !== "control" || merges.has(to.node)) continue;
    if (own(types.get(from.node)?.outputs, from.handle)?.exclusive !== true) continue;
    const key = `${to.node}\0${to.handle}\0${from.node}`;
    const entry = fed.get(key) ?? { node: to.node, handle: to.handle, from: from.node, outputs: new Set<string>() };
    fed.set(key, { ...entry, outputs: entry.outputs.add(from.handle) });
  }
  return [...fed.values()]
    .filter(({ outputs }) => outputs.size > 1)
    .map(({ node, handle, from }): Finding => ({ code: "workflow.exclusive-sources", params: { node, handle, from } }));
};

/**
 * Inputs a run can lack: a required node input fed by an optional workflow input without a default, and a required
 * workflow input without a default when a schedule starts the run, which gives no inputs.
 */
const inputFindings = ({ workflow, nodes, types, edges }: Graph): Finding[] => {
  const inputs = workflow.inputs ?? {};
  const optional = edges.flatMap(({ from, to }): Finding[] => {
    const input = "input" in from ? own(inputs, from.input) : undefined;
    if (!("input" in from) || !("node" in to) || input === undefined) return [];
    const unset = input.required !== true && input.default === undefined;
    if (!unset || own(types.get(to.node)?.inputs, to.handle)?.required !== true) return [];
    return [{ code: "workflow.optional-input", params: { node: to.node, handle: to.handle, input: from.input } }];
  });
  const scheduled = nodes.some((node) => node.type === "trigger.schedule");
  const unfilled = Object.entries(inputs).filter(([, input]) => input.required === true && input.default === undefined);
  return [
    ...optional,
    ...(scheduled ? unfilled : []).map(([input]): Finding => ({ code: "workflow.schedule-input", params: { input } })),
  ];
};

/** Node to node links of the edges `keep` accepts. */
const links = (resolved: Item[], keep: (item: Item) => boolean): Map<string, string[]> => {
  const next = new Map<string, string[]>();
  for (const { edge } of resolved.filter(keep)) {
    const { from, to } = edge;
    if ("node" in from && "node" in to) next.set(from.node, [...(next.get(from.node) ?? []), to.node]);
  }
  return next;
};

// The first of each id, in document order.
const unique = <T extends { id: string }>(items: T[]): T[] =>
  items.filter((item, index) => items.findIndex((other) => other.id === item.id) === index);

const valid = ({ from, to }: Item): boolean => typeof from === "string" && typeof to === "string";

/**
 * The findings of a workflow's graph, beyond its schema: duplicate ids, one trigger, known node types, edges between
 * existing, compatible handles, one source per data input and output, joins with branches, no cycle, and every node
 * reached, and no node type that waits until after 0.1.0. Edges of nodes of an unknown type, or of an extension action
 * `actions` lacks, get no further findings. None with severity `error`: the editor and the CLI accept the workflow.
 */
export const validateWorkflow = (workflow: WorkflowDefinition, actions: ActionCatalog = new Map()): Finding[] => {
  const [nodes, edges] = [unique(workflow.nodes), unique(workflow.edges)];
  // Only extension types by the contracts' rules: a catalog never stands in for a built-in type or any other name.
  const extensions: ActionCatalog = new Map([...actions].filter(([type]) => isExtensionType(type)));
  const types = new Map(nodes.map((node) => [node.id, nodeType(node.type, extensions)]));
  const lookup = { workflow, types };
  const resolved = edges.map((edge) => ({
    edge,
    from: resolve(lookup, edge.id, "from", edge.from),
    to: resolve(lookup, edge.id, "to", edge.to),
  }));
  const named = ({ edge: { from, to }, to: type }: Item): boolean =>
    "node" in from &&
    "node" in to &&
    types.has(from.node) &&
    types.has(to.node) &&
    (type === "control" || typeof type !== "string");
  const graph = {
    ...lookup,
    actions,
    nodes,
    edges,
    resolved,
    next: links(resolved, valid),
    reach: links(resolved, named),
  };
  const checks = [
    duplicates,
    nodeFindings,
    edgeFindings,
    twins,
    sourceFindings,
    exclusiveSources,
    inputFindings,
    cycle,
    unreachable,
    strays,
    scheduledReports,
  ];
  return checks.flatMap((check) => check(graph));
};
