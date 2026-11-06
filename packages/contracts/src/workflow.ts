import { z } from "zod";
import { canonicalJson, type Json, sortKeys } from "./json.ts";
import { fileFormats } from "./registry.ts";

/** The workflow format this CedarLoom writes and reads; readers refuse a newer one. */
export const WORKFLOW_SCHEMA_VERSION = 1;

// Ids of nodes and edges stay the same across edits: the layout, the execution policies and run history key on them.
const id = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
/** The id of a workflow (its `metadata.id`), and of a node. */
export const WorkflowId = id;
// Names of handles and of the workflow's inputs and outputs.
export const HandleName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/);
export const semver = z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
const description = z.string().max(2000).optional();
// SPDX license expression (`MIT`, `MIT OR Apache-2.0`, `DocumentRef-x:LicenseRef-y`): its characters, words one space
// apart; readers show it, never parse it.
export const License = z
  .string()
  .max(200)
  .regex(/^[A-Za-z0-9.+():-]+(?: [A-Za-z0-9.+():-]+)*$/)
  .describe("SPDX license expression");

/** Any JSON value. */
export const JsonValue = z.json().register(fileFormats, { id: "JsonValue" });

/** What a data handle carries; `json` takes any JSON value. */
export const DataType = z.enum(["string", "number", "boolean", "json"]).register(fileFormats, { id: "DataType" });

/** What a handle carries: `control` orders nodes and carries no data. */
export const HandleType = z.enum(["control", ...DataType.options]).register(fileFormats, { id: "HandleType" });
export type HandleType = z.infer<typeof HandleType>;

/** When a join lets the run continue: once all its branches ended, or once the first did. */
const JoinPolicy = z.enum(["all", "any"]).register(fileFormats, { id: "JoinPolicy" });

/** The configuration of a `join` node. */
export const JoinConfig = z.strictObject({ policy: JoinPolicy }).register(fileFormats, { id: "JoinConfig" });

/** What a failed node does to the run, unless an edge from its `failed` handle routes the failure. */
const FailurePolicy = z.enum(["fail_fast", "continue_independent"]).register(fileFormats, { id: "FailurePolicy" });

/** One node of the graph: its type names its handles, `with` its configuration. */
const WorkflowNode = z
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

const handleEnd = z.strictObject({ node: id, handle: HandleName });

/** A directed connection from an output handle (or a workflow input) to an input handle (or a workflow output). */
const WorkflowEdge = z
  .strictObject({
    id,
    from: z.union([handleEnd, z.strictObject({ input: HandleName })]),
    to: z.union([handleEnd, z.strictObject({ output: HandleName })]),
  })
  .register(fileFormats, { id: "WorkflowEdge" });

// One input type with a default of that type, which fills the input when a run gives none.
const inputOf = <T extends z.ZodType>(type: z.infer<typeof DataType>, value: T) =>
  z.strictObject({ type: z.literal(type), required: z.boolean().optional(), default: value.optional(), description });

/** An input of the workflow; its `default` has the input's type. */
const WorkflowInput = z
  .discriminatedUnion("type", [
    inputOf("string", z.string()),
    inputOf("number", z.number()),
    inputOf("boolean", z.boolean()),
    inputOf("json", JsonValue),
  ])
  .register(fileFormats, { id: "WorkflowInput" });

const nodePolicy = z.strictObject({
  failurePolicy: FailurePolicy.optional(),
  timeoutSeconds: z.int().min(1).max(86_400).optional(),
  retries: z.int().min(0).max(10).optional(),
});

/**
 * A workflow: metadata, typed inputs and outputs, the graph (nodes and edges), then the execution policy and the
 * editor's layout, each in a section of its own, so moving a node or changing a policy leaves the graph untouched.
 * The graph and the execution policy are strict; metadata and layout keep keys this version does not know (tools
 * may add their own), and readers ignore them.
 */
export const WorkflowDefinition = z
  .strictObject({
    $schema: z.string().optional().describe("Where an editor finds this JSON Schema; readers ignore it"),
    schemaVersion: z.literal(WORKFLOW_SCHEMA_VERSION),
    kind: z.literal("cedarloom.workflow"),
    metadata: z
      .object({
        id,
        name: z.string().min(1).max(200),
        version: semver,
        description,
        minApp: semver.optional().describe("The oldest CedarLoom version that runs this workflow"),
        license: License.optional().describe("The workflow's own license, which an import keeps"),
      })
      .catchall(JsonValue),
    inputs: z.record(HandleName, WorkflowInput).optional(),
    outputs: z.record(HandleName, z.strictObject({ type: DataType, description })).optional(),
    // Bounds for files from elsewhere: the editor and the validator stay quick, and recursion over paths shallow.
    nodes: z.array(WorkflowNode).min(1).max(1000),
    edges: z.array(WorkflowEdge).max(5000),
    execution: z
      .strictObject({
        maxConcurrency: z.int().min(1).max(64).optional(),
        failurePolicy: FailurePolicy.optional().describe("For the whole run; `fail_fast` when absent"),
        nodes: z.record(id, nodePolicy).optional(),
      })
      .optional(),
    layout: z
      .object({ nodes: z.record(id, z.object({ x: z.number(), y: z.number() }).catchall(JsonValue)) })
      .catchall(JsonValue)
      .optional(),
  })
  .describe("A CedarLoom workflow; readers also refuse values nested over 32 levels deep, which JSON Schema can't say")
  .register(fileFormats, { id: "WorkflowDefinition" });
export type WorkflowDefinition = z.infer<typeof WorkflowDefinition>;

const order = (a: string, b: string): number => (a < b ? -1 : Number(a > b));
// By id; repeated ids (a validation finding) by their whole content, so the order of the input never shows.
const byId = <T extends { id: string } & Json>(items: T[]): T[] =>
  items.toSorted((a, b) => order(a.id, b.id) || order(canonicalJson(a), canonicalJson(b)));

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
