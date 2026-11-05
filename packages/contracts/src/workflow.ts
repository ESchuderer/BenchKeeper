import { z } from "zod";
import { sortKeys } from "./json.ts";
import { fileFormats } from "./registry.ts";

/** The workflow format this CedarLoom writes and reads; readers refuse a newer one. */
export const WORKFLOW_SCHEMA_VERSION = 1;

// Ids of nodes and edges stay the same across edits: the layout, the execution policies and run history key on them.
const id = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
// Names of handles and of the workflow's inputs and outputs.
const name = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/);
const semver = z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
const description = z.string().max(2000).optional();

/** Any JSON value. */
const JsonValue = z.json().register(fileFormats, { id: "JsonValue" });

/** What a data handle carries; `json` takes any JSON value. */
export const DataType = z.enum(["string", "number", "boolean", "json"]).register(fileFormats, { id: "DataType" });

/** What a handle carries: `control` orders nodes and carries no data. */
export const HandleType = z.enum(["control", ...DataType.options]).register(fileFormats, { id: "HandleType" });
export type HandleType = z.infer<typeof HandleType>;

/** When a join lets the run continue: once all its branches ended, or once the first did. */
export const JoinPolicy = z.enum(["all", "any"]).register(fileFormats, { id: "JoinPolicy" });

/** The configuration of a `join` node. */
export const JoinConfig = z.strictObject({ policy: JoinPolicy }).register(fileFormats, { id: "JoinConfig" });

/** What a failed node does to the run, unless an edge from its `failed` handle routes the failure. */
export const FailurePolicy = z
  .enum(["fail_fast", "continue_independent"])
  .register(fileFormats, { id: "FailurePolicy" });

/** One node of the graph: its type names its handles, `with` its configuration. */
export const WorkflowNode = z
  .strictObject({
    id,
    type: z
      .string()
      .regex(/^[a-z][a-z0-9-]*([./][a-z][a-z0-9-]*)*$/)
      .describe("A built-in node type such as `command.run`; the engine refuses types it does not know"),
    with: z
      .record(z.string(), JsonValue)
      .optional()
      .describe("The node's configuration; the engine checks it against the node type"),
  })
  .register(fileFormats, { id: "WorkflowNode" });
export type WorkflowNode = z.infer<typeof WorkflowNode>;

const handleEnd = z.strictObject({ node: id, handle: name });

/** A directed connection from an output handle (or a workflow input) to an input handle (or a workflow output). */
export const WorkflowEdge = z
  .strictObject({
    id,
    from: z.union([handleEnd, z.strictObject({ input: name })]),
    to: z.union([handleEnd, z.strictObject({ output: name })]),
  })
  .register(fileFormats, { id: "WorkflowEdge" });
export type WorkflowEdge = z.infer<typeof WorkflowEdge>;

const nodePolicy = z.strictObject({
  failurePolicy: FailurePolicy.optional(),
  timeoutSeconds: z.int().min(1).max(86_400).optional(),
  retries: z.int().min(0).max(10).optional(),
});

/**
 * A workflow: metadata, typed inputs and outputs, the graph (nodes and edges), then the execution policy and the
 * editor's layout, each in a section of its own, so moving a node or changing a policy leaves the graph untouched.
 */
export const WorkflowDefinition = z
  .strictObject({
    schemaVersion: z.literal(WORKFLOW_SCHEMA_VERSION),
    kind: z.literal("cedarloom.workflow"),
    metadata: z.strictObject({
      id,
      name: z.string().min(1).max(200),
      version: semver,
      description,
      minApp: semver.optional().describe("The oldest CedarLoom version that runs this workflow"),
    }),
    inputs: z
      .record(name, z.strictObject({ type: DataType, required: z.boolean().optional(), description }))
      .optional(),
    outputs: z.record(name, z.strictObject({ type: DataType, description })).optional(),
    nodes: z.array(WorkflowNode).min(1),
    edges: z.array(WorkflowEdge),
    execution: z
      .strictObject({
        maxConcurrency: z.int().min(1).max(64).optional(),
        failurePolicy: FailurePolicy.optional().describe("For the whole run; `fail_fast` when absent"),
        nodes: z.record(id, nodePolicy).optional(),
      })
      .optional(),
    layout: z.strictObject({ nodes: z.record(id, z.strictObject({ x: z.number(), y: z.number() })) }).optional(),
  })
  .register(fileFormats, { id: "WorkflowDefinition" });
export type WorkflowDefinition = z.infer<typeof WorkflowDefinition>;

const byId = <T extends { id: string }>(items: T[]): T[] => items.toSorted((a, b) => (a.id < b.id ? -1 : 1));

/**
 * The file text of a workflow: nodes and edges sorted by id, each object's keys in the schema's order and the keys of
 * maps (inputs, layout, configuration) sorted, two-space indent and a final newline. Equal workflows are equal files,
 * and a Git diff shows what changed, not where an editor put it.
 */
export const formatWorkflow = (workflow: WorkflowDefinition): string => {
  const sorted = sortKeys({ ...workflow, nodes: byId(workflow.nodes), edges: byId(workflow.edges) });
  // Parsing writes each object's keys in the order of its schema; maps keep the sorted order.
  return `${JSON.stringify(WorkflowDefinition.parse(sorted), null, 2)}\n`;
};
