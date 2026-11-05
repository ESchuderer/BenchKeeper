import { type Finding, type HandleType, JoinConfig, type WorkflowDefinition } from "@cedarloom/contracts";

/** Whether an edge may join two handles: `unchecked` passes a `json` value on to a typed input, checked when it runs. */
export type Compatibility = "yes" | "unchecked" | "no";

/** The one compatibility rule of typed handles, for the editor while a user drags an edge and for the CLI validator. */
export const compatibility = (from: HandleType, to: HandleType): Compatibility => {
  if (from === to) return "yes";
  if (from === "control" || to === "control") return "no";
  if (to === "json") return "yes";
  return from === "json" ? "unchecked" : "no";
};

/** A handle of a node type; a `required` data input needs an edge. Control inputs take many edges, data inputs one. */
export type Handle = { type: HandleType; required?: true };
export type NodeType = { inputs: Record<string, Handle>; outputs: Record<string, Handle> };

const control: Handle = { type: "control" };
const text: Handle = { type: "string" };
const run = { run: control };
// `failed` routes a failure along an edge instead of the run's failure policy.
const ended = { done: control, failed: control };

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
    outputs: { true: control, false: control },
  },
  join: { inputs: { branches: control }, outputs: { done: control } },
  "human.approval": { inputs: run, outputs: { approved: control, rejected: control } },
  "workflow.run": { inputs: run, outputs: ended },
};

type Edge = WorkflowDefinition["edges"][number];
type End = Edge["from"] | Edge["to"];
type Resolved = HandleType | Finding | null;
type Graph = {
  workflow: WorkflowDefinition;
  /** One node per id, the first of duplicates (a finding of its own), in document order. */
  nodes: WorkflowDefinition["nodes"];
  types: Map<string, NodeType | undefined>;
  /** Each edge with the types of its ends, a finding for an end that names nothing, or null for an unknown node type. */
  resolved: { edge: Edge; from: Resolved; to: Resolved }[];
  /** Node to node links of the edges without a finding of their own. */
  next: Map<string, string[]>;
};

// Own keys only: a node type, handle or field named like an Object property (`constructor`) is none.
const own = <T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined =>
  record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;

const duplicates = ({ workflow }: Graph): Finding[] =>
  (["node", "edge"] as const).flatMap((kind) => {
    const ids = (kind === "node" ? workflow.nodes : workflow.edges).map((item) => item.id);
    const twice = ids.filter((id, index) => ids.indexOf(id) !== index);
    return [...new Set(twice)].map((id): Finding => ({ code: "workflow.duplicate-id", params: { kind, id } }));
  });

const isTrigger = (node: { type: string }): boolean => node.type.startsWith("trigger.");

const nodeFindings = ({ nodes }: Graph): Finding[] => {
  const triggers = nodes.filter(isTrigger).length;
  return [
    ...(triggers === 1 ? [] : [{ code: "workflow.trigger-count", params: { count: triggers } } as const]),
    ...nodes.flatMap((node): Finding[] => {
      if (own(NODE_TYPES, node.type) === undefined) {
        return [{ code: "workflow.unknown-node-type", params: { node: node.id, type: node.type } }];
      }
      const config = node.type === "join" ? JoinConfig.safeParse(node.with ?? {}) : { success: true as const };
      if (config.success) return [];
      const issues = config.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code }));
      return [{ code: "workflow.invalid-config", params: { node: node.id, issues } }];
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

/** One edge into each data input and workflow output (none for an optional input), two or more into a join. */
const sourceFindings = ({ workflow, nodes, types }: Graph): Finding[] => {
  const counts = new Map<string, number>();
  for (const { to } of workflow.edges) {
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
      const edges = count(node, handle);
      if (edges > 1) return [{ code: "workflow.many-sources", params: { node, handle, count: edges } }];
      return edges === 0 && required ? [{ code: "workflow.missing-source", params: { node, handle } }] : [];
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

/** Nodes of a known type that no path from the trigger or a workflow input reaches: they would never run. */
const unreachable = ({ nodes, types, resolved, next }: Graph): Finding[] => {
  const triggers = nodes.filter(isTrigger);
  if (triggers.length !== 1) return [];
  const inputs = resolved.flatMap(({ edge, to }) =>
    "input" in edge.from && "node" in edge.to && typeof to === "string" ? [edge.to.node] : [],
  );
  const seen = new Set([...triggers.map((node) => node.id), ...inputs]);
  const queue = [...seen];
  for (const node of queue) {
    for (const to of (next.get(node) ?? []).filter((item) => !seen.has(item))) {
      seen.add(to);
      queue.push(to);
    }
  }
  return nodes
    .filter((node) => !seen.has(node.id) && types.get(node.id) !== undefined)
    .map((node): Finding => ({ code: "workflow.unreachable", params: { node: node.id } }));
};

const strays = ({ workflow, types }: Graph): Finding[] =>
  (["execution", "layout"] as const).flatMap((section) =>
    Object.keys(workflow[section]?.nodes ?? {})
      .filter((node) => !types.has(node))
      .map((node): Finding => ({ code: "workflow.stray-entry", params: { section, node } })),
  );

const links = (resolved: Graph["resolved"]): Map<string, string[]> => {
  const next = new Map<string, string[]>();
  for (const { edge, from, to } of resolved) {
    const valid = typeof from === "string" && typeof to === "string";
    if (valid && "node" in edge.from && "node" in edge.to) {
      next.set(edge.from.node, [...(next.get(edge.from.node) ?? []), edge.to.node]);
    }
  }
  return next;
};

/**
 * The findings of a workflow's graph, beyond its schema: duplicate ids, one trigger, known node types, edges between
 * existing, compatible handles, one source per data input and output, joins with branches, no cycle, and every node
 * reached. Edges of nodes of an unknown type get no further findings. None with severity `error`: the editor and the
 * CLI accept the workflow.
 */
export const validateWorkflow = (workflow: WorkflowDefinition): Finding[] => {
  const nodes = workflow.nodes.filter(
    (node, index) => workflow.nodes.findIndex((item) => item.id === node.id) === index,
  );
  const lookup = { workflow, types: new Map(nodes.map((node) => [node.id, own(NODE_TYPES, node.type)])) };
  const resolved = workflow.edges.map((edge) => ({
    edge,
    from: resolve(lookup, edge.id, "from", edge.from),
    to: resolve(lookup, edge.id, "to", edge.to),
  }));
  const graph = { ...lookup, nodes, resolved, next: links(resolved) };
  const checks = [duplicates, nodeFindings, edgeFindings, sourceFindings, cycle, unreachable, strays];
  return checks.flatMap((check) => check(graph));
};
