import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { HandleType, NODE_CONFIGS, WorkflowDefinition } from "@cedarloom/contracts";
import { validateWorkflow } from "@cedarloom/engine";
import { compatibility, endType, NODE_TYPES } from "@cedarloom/engine/graph";
import * as fc from "fast-check";
import { expect, test } from "vitest";

type Edge = WorkflowDefinition["edges"][number];

const at = (end: string): { node: string; handle: string } => {
  const [node = "", handle = ""] = end.split(".");
  return { node, handle };
};
// "a.done>b.run" is an edge from handle done of a to handle run of b; "@x" is the workflow input or output x.
const edge = (id: string, spec: string): Edge => {
  const [from = "", to = ""] = spec.split(">");
  return {
    id,
    from: from.startsWith("@") ? { input: from.slice(1) } : at(from),
    to: to.startsWith("@") ? { output: to.slice(1) } : at(to),
  };
};

// A valid configuration for each node type that needs one, so a test about the graph meets no configuration finding.
const configured: Record<string, object> = {
  "trigger.schedule": { cron: "0 3 * * *", precheck: "true" },
  "agent.run": { task: "Review." },
  "command.run": { command: "true" },
  "file.read": { path: "in.md" },
  "file.write": { path: "out.md" },
  "human.approval": { message: "Go on?" },
  "workflow.run": { workflow: "child.json" },
};

// An own entry only: a type named like an Object property (`constructor`) has no configuration here.
const preset = (type: string): object | undefined => (Object.hasOwn(configured, type) ? configured[type] : undefined);

const workflow = (nodes: string[], edges: string[], more: object = {}): WorkflowDefinition =>
  WorkflowDefinition.parse({
    schemaVersion: 1,
    kind: "cedarloom.workflow",
    metadata: { id: "w", name: "W", version: "1.0.0" },
    // "id:type" (with the type's valid configuration, if it needs one) or "id:type:json-of-with"
    nodes: nodes.map((node) => {
      const [id = "", type = "", ...config] = node.split(":");
      const given = config.length === 0 ? preset(type) : JSON.parse(config.join(":"));
      return { id, type, ...(given === undefined ? {} : { with: given }) };
    }),
    edges: edges.map((spec, index) => edge(`e${index + 1}`, spec)),
    ...more,
  });

const codes = (definition: WorkflowDefinition): string[] => validateWorkflow(definition).map((f) => f.code);
const start = "start:trigger.manual";

test("compatibility: control only with control, json takes every data type, json into a typed input is checked later", () => {
  const types = HandleType.options;
  const table = Object.fromEntries(types.map((from) => [from, types.map((to) => compatibility(from, to)).join(" ")]));
  expect(table).toEqual({
    control: "yes no no no no",
    string: "no yes no no yes",
    number: "no no yes no yes",
    boolean: "no no no yes yes",
    json: "no unchecked unchecked unchecked yes",
  });
});

test("endType names the type of an edge end: outputs and workflow inputs start edges, inputs and outputs end them", () => {
  const graph = workflow([start, "a:agent.run", "x:nope.unknown"], [], {
    inputs: { focus: { type: "string" } },
    outputs: { report: { type: "string" } },
  });
  const ends = [
    [{ node: "a", handle: "result" }, "from"],
    [{ node: "a", handle: "context" }, "to"],
    [{ node: "a", handle: "context" }, "from"],
    [{ node: "gone", handle: "run" }, "to"],
    [{ node: "x", handle: "run" }, "to"],
    [{ input: "focus" }, "from"],
    [{ input: "focus" }, "to"],
    [{ output: "report" }, "to"],
    [{ output: "report" }, "from"],
    [{ input: "constructor" }, "from"],
  ] as const;
  expect(ends.map(([end, side]) => endType(graph, end, side) ?? "none")).toEqual([
    "string",
    "string",
    "none",
    "none",
    "none",
    "string",
    "none",
    "string",
    "none",
    "none",
  ]);
});

const yes = (from: HandleType, to: HandleType): boolean => compatibility(from, to) === "yes";

// Each law is an implication: not (premise), or (conclusion).
const laws: Record<string, (a: HandleType, b: HandleType, c: HandleType) => boolean> = {
  reflexive: (a) => yes(a, a),
  antisymmetric: (a, b) => !(yes(a, b) && yes(b, a)) || a === b,
  transitive: (a, b, c) => !(yes(a, b) && yes(b, c)) || yes(a, c),
  "unchecked only from json": (a, b) => compatibility(a, b) !== "unchecked" || a === "json",
  "control only with control": (a, b) => (a === "control") === (b === "control") || compatibility(a, b) === "no",
};

test.each(Object.entries(laws))("compatibility law: %s", (_, law) => {
  const type = fc.constantFrom(...HandleType.options);
  expect(() => fc.assert(fc.property(type, type, type, law))).not.toThrow();
});

// The graph findings of the golden workflows named findings-*; valid-* have none.
const goldenFindings: Record<string, string[]> = {
  "findings-duplicate-edge.json": ["workflow.duplicate-edge"],
  "findings-exclusive-sources.json": ["workflow.exclusive-sources"],
  "findings-optional-input.json": ["workflow.optional-input"],
  "findings-schedule-input.json": ["workflow.schedule-input"],
  "findings-report-only-write.json": ["workflow.report-only-write"],
  "findings-node-configs.json": Array.from({ length: 8 }, () => "workflow.invalid-config"),
};

test("the golden corpus: valid workflows have clean graphs, findings-* exactly the findings they are named for", async () => {
  const dir = join(import.meta.dirname, "..", "..", "contracts", "corpus", "WorkflowDefinition", "1");
  const names = (await readdir(dir)).filter((name) => !name.startsWith("invalid-"));
  expect(Object.keys(goldenFindings).filter((name) => !names.includes(name))).toEqual([]);
  for (const name of names) {
    const definition = WorkflowDefinition.parse(JSON.parse(await readFile(join(dir, name), "utf8")));
    expect([name, codes(definition)]).toEqual([name, goldenFindings[name] ?? []]);
  }
});

test("twin edges (one output to one input twice) are one finding; a join fed by twins has one branch", () => {
  const graph = workflow(
    [start, "a:command.run", "r:agent.run", 'j:join:{"policy":"all"}'],
    ["start.start>a.run", "start.start>a.run", "a.stdout>r.context", "a.stdout>r.context", "a.done>r.run"].concat([
      "a.done>j.branches",
      "a.done>j.branches",
    ]),
  );
  // An end written with its keys in another order is the same end.
  const swapped = {
    ...graph,
    edges: graph.edges.map((item, index) => (index === 1 ? { ...item, to: { handle: "run", node: "a" } } : item)),
  };
  expect(validateWorkflow(swapped)).toEqual(validateWorkflow(graph));
  expect(validateWorkflow(graph)).toEqual([
    { code: "workflow.duplicate-edge", params: { edge: "e2", of: "e1" } },
    { code: "workflow.duplicate-edge", params: { edge: "e4", of: "e3" } },
    { code: "workflow.duplicate-edge", params: { edge: "e7", of: "e6" } },
    { code: "workflow.join-branches", params: { node: "j", count: 1 } },
  ]);
});

test("skips: exclusive outputs into one control input are a warning, unless a join with policy any merges them", () => {
  const graph = workflow(
    [start, "c:command.run", "a:human.approval", "x:command.run", 'm:join:{"policy":"any"}', 'k:join:{"policy":"all"}'],
    ["start.start>c.run", "c.done>a.run", "c.failed>a.run", "a.approved>x.run", "a.rejected>x.run"].concat([
      "a.approved>m.branches",
      "a.rejected>m.branches",
      "c.done>k.branches",
      "c.failed>k.branches",
    ]),
  );
  expect(validateWorkflow(graph)).toEqual([
    { code: "workflow.exclusive-sources", params: { node: "a", handle: "run", from: "c" } },
    { code: "workflow.exclusive-sources", params: { node: "x", handle: "run", from: "a" } },
    { code: "workflow.exclusive-sources", params: { node: "k", handle: "branches", from: "c" } },
  ]);
});

test("inputs a run can lack: optional without a default into a required input, required without a default on a schedule", () => {
  const inputs = {
    loose: { type: "boolean" },
    fallback: { type: "boolean", default: true },
    given: { type: "boolean", required: true },
    text: { type: "string" },
  };
  const graph = workflow(
    ["start:trigger.schedule", "a:condition", "b:condition", "c:condition", "r:agent.run"],
    [
      "start.start>a.run",
      "@loose>a.value",
      "a.true>b.run",
      "@fallback>b.value",
      "b.true>c.run",
      "@given>c.value",
    ].concat(["c.true>r.run", "@text>r.context"]),
    { inputs },
  );
  expect(validateWorkflow(graph)).toEqual([
    { code: "workflow.optional-input", params: { node: "a", handle: "value", input: "loose" } },
    { code: "workflow.schedule-input", params: { input: "given" } },
  ]);
  // A manual trigger lets the person who starts the run give the required input.
  expect(
    codes({ ...graph, nodes: graph.nodes.map((n) => (n.id === "start" ? { id: n.id, type: "trigger.manual" } : n)) }),
  ).toEqual(["workflow.optional-input"]);
});

test("duplicate ids, a missing or second trigger, unknown types and a join without its policy are found", () => {
  const twice = workflow([start, "a:command.run", "a:command.run"], ["start.start>a.run", "start.start>a.run"]);
  expect(validateWorkflow({ ...twice, edges: twice.edges.map((item) => ({ ...item, id: "e1" })) })).toEqual([
    { code: "workflow.duplicate-id", params: { kind: "node", id: "a" } },
    { code: "workflow.duplicate-id", params: { kind: "edge", id: "e1" } },
  ]);
  expect(codes(workflow(["a:command.run"], []))).toEqual(["workflow.trigger-count"]);
  expect(validateWorkflow(workflow([start, "again:trigger.schedule"], []))).toEqual([
    { code: "workflow.trigger-count", params: { count: 2 } },
  ]);
  // A type named like an Object property is no node type; edges of unknown nodes get no findings of their own.
  expect(validateWorkflow(workflow([start, "x:constructor"], ["start.start>x.anything"]))).toEqual([
    { code: "workflow.unknown-node-type", params: { node: "x", type: "constructor" } },
  ]);
  const joins = workflow([start, "j:join", 'k:join:{"policy":"some"}'], []);
  expect(validateWorkflow(joins).filter((finding) => finding.code === "workflow.invalid-config")).toEqual([
    { code: "workflow.invalid-config", params: { node: "j", issues: [{ path: "policy", code: "invalid_value" }] } },
    { code: "workflow.invalid-config", params: { node: "k", issues: [{ path: "policy", code: "invalid_value" }] } },
  ]);
});

test("edges must start and end at handles that exist, in the right direction", () => {
  const graph = workflow(
    [start, "a:command.run"],
    ["gone.done>a.run", "@nope>a.run", "a.done>@nope", "a.run>a.run", "start.start>a.constructor"],
  );
  expect(validateWorkflow(graph)).toEqual([
    { code: "workflow.dangling-edge", params: { edge: "e1", end: "from", ref: "gone" } },
    { code: "workflow.dangling-edge", params: { edge: "e2", end: "from", ref: "nope" } },
    { code: "workflow.dangling-edge", params: { edge: "e3", end: "to", ref: "nope" } },
    { code: "workflow.unknown-handle", params: { edge: "e4", end: "from", handle: "a.run" } },
    { code: "workflow.unknown-handle", params: { edge: "e5", end: "to", handle: "a.constructor" } },
  ]);
});

test("typed handles: an incompatible edge is an error, json into a typed input a warning", () => {
  const graph = workflow(
    [start, "a:command.run", "r:agent.run", "c:condition"],
    ["start.start>a.run", "a.exitCode>r.context", "a.done>c.value", "@flag>c.value"],
    { inputs: { flag: { type: "json", required: true } } },
  );
  expect(validateWorkflow(graph)).toEqual([
    { code: "workflow.incompatible-handles", params: { edge: "e2", from: "number", to: "string" } },
    { code: "workflow.incompatible-handles", params: { edge: "e3", from: "control", to: "boolean" } },
    { code: "workflow.unchecked-handles", params: { edge: "e4", from: "json", to: "boolean" } },
    { code: "workflow.many-sources", params: { node: "c", handle: "value", count: 2 } },
  ]);
});

test("a data input and a workflow output take one edge; required ones need it; a join needs two branches", () => {
  const graph = workflow(
    [start, "a:command.run", "c:condition", 'j:join:{"policy":"all"}'],
    ["start.start>a.run", "a.stdout>@log", "@note>@log", "a.done>j.branches"],
    {
      inputs: { note: { type: "string", required: true } },
      outputs: { log: { type: "string" }, unset: { type: "json" } },
    },
  );
  expect(validateWorkflow(graph)).toEqual([
    { code: "workflow.join-branches", params: { node: "j", count: 1 } },
    { code: "workflow.many-sources", params: { node: null, handle: "log", count: 2 } },
    { code: "workflow.missing-source", params: { node: null, handle: "unset" } },
    { code: "workflow.missing-source", params: { node: "c", handle: "value" } },
    { code: "workflow.unreachable", params: { node: "c" } },
  ]);
});

test("a cycle is found with its nodes in order, a self-loop too; policies and positions of unknown nodes are strays", () => {
  const loop = workflow(
    [start, "a:command.run", "b:command.run"],
    ["start.start>a.run", "a.done>b.run", "b.done>a.run"],
  );
  expect(validateWorkflow(loop)).toEqual([{ code: "workflow.cycle", params: { nodes: ["a", "b"] } }]);
  expect(codes(workflow([start, "a:command.run"], ["a.done>a.run"]))).toEqual([
    "workflow.cycle",
    "workflow.unreachable",
  ]);
  const strays = workflow([start], [], {
    execution: { nodes: { gone: { retries: 1 } } },
    layout: { nodes: { start: { x: 0, y: 0 }, old: { x: 1, y: 1 } } },
  });
  expect(validateWorkflow(strays)).toEqual([
    { code: "workflow.stray-entry", params: { section: "execution", node: "gone" } },
    { code: "workflow.stray-entry", params: { section: "layout", node: "old" } },
  ]);
});

test("a node no path from the trigger or an input reaches never runs; duplicate ids give each finding once", () => {
  const graph = workflow([start, "a:command.run", "c:condition", "c:condition"], ["@flag>c.value"], {
    inputs: { flag: { type: "boolean", required: true } },
  });
  expect(validateWorkflow(graph)).toEqual([
    { code: "workflow.duplicate-id", params: { kind: "node", id: "c" } },
    { code: "workflow.unreachable", params: { node: "a" } },
  ]);
  // Without one trigger, reach is not judged: the trigger count is the finding.
  expect(codes(workflow(["a:command.run"], []))).toEqual(["workflow.trigger-count"]);
});

test("one mistake gives one finding: nodes behind a bad edge or unknown node stay reached, duplicates report once", () => {
  const unknown = workflow([start, "x:git.commit", "a:command.run"], ["start.start>x.run", "x.done>a.run"]);
  expect(codes(unknown)).toEqual(["workflow.unknown-node-type"]);
  expect(codes(workflow([start, "a:command.run"], ["start.start>a.rn"]))).toEqual(["workflow.unknown-handle"]);
  expect(codes(workflow(["w:trigger.webhook", "a:command.run"], ["w.start>a.run"]))).toEqual([
    "workflow.unknown-node-type",
  ]);
  // Without deduplication each copy of node c would report its missing value.
  expect(codes(workflow([start, "c:condition", "c:condition"], ["start.start>c.run"]))).toEqual([
    "workflow.duplicate-id",
    "workflow.missing-source",
  ]);
  const twice = workflow([start, "a:command.run"], ["start.start>a.run", "gone.done>a.run", "gone.done>a.run"]);
  const edges = twice.edges.map((item, index) => (index === 0 ? item : { ...item, id: "e2" }));
  expect(codes({ ...twice, edges })).toEqual(["workflow.duplicate-id", "workflow.dangling-edge"]);
});

// A chain of command nodes after the trigger, plus random forward edges: a DAG by construction.
const dags = fc
  .integer({ min: 1, max: 12 })
  .chain((count) =>
    fc.tuple(
      fc.constant(count),
      fc.array(fc.tuple(fc.nat(count - 1), fc.nat(count - 1)), { maxLength: 20 }),
      fc.tuple(fc.nat(count - 1), fc.nat(count - 1)),
    ),
  );

test("random DAGs have clean graphs, and one edge back along the chain makes exactly one cycle finding, a real cycle", () => {
  fc.assert(
    fc.property(dags, ([count, extra, [x, y]]) => {
      const nodes = [start, ...Array.from({ length: count }, (_, index) => `c${index}:command.run`)];
      const chain = Array.from({ length: count }, (_, index) =>
        index === 0 ? "start.start>c0.run" : `c${index - 1}.done>c${index}.run`,
      );
      // Forward edges that skip ahead, once each: an edge along the chain again would be a twin.
      const forward = [...new Set(extra.filter(([a, b]) => b > a + 1).map(([a, b]) => `c${a}.done>c${b}.run`))];
      expect(validateWorkflow(workflow(nodes, [...chain, ...forward]))).toEqual([]);
      const [low, high] = [Math.min(x, y), Math.max(x, y)];
      const back = workflow(nodes, [...chain, ...forward, `c${high}.done>c${low}.run`]);
      const found = validateWorkflow(back);
      expect(found.map((finding) => finding.code)).toEqual(["workflow.cycle"]);
      const cycle = found[0]?.code === "workflow.cycle" ? found[0].params.nodes : [];
      const linked = new Set(
        back.edges.flatMap((e) => ("node" in e.from && "node" in e.to ? [`${e.from.node}>${e.to.node}`] : [])),
      );
      expect(cycle.every((node, index) => linked.has(`${node}>${cycle[(index + 1) % cycle.length]}`))).toBe(true);
    }),
  );
});

test("every node type has a configuration schema, and a node's `with` is checked against its type's", () => {
  expect(Object.keys(NODE_CONFIGS).toSorted()).toEqual(Object.keys(NODE_TYPES).toSorted());
  const graph = workflow(
    [
      'start:trigger.manual:{"precheck":"test -d .git"}',
      "a:command.run:{}",
      'b:command.run:{"command":"pnpm test","cwd":"../up"}',
      'c:agent.run:{"task":"Plan it.","phase":"plan","provider":"claude-code"}',
      'd:file.read:{"path":"/etc/hosts"}',
    ],
    ["start.start>a.run", "start.start>b.run", "start.start>c.run", "start.start>d.run"],
  );
  expect(validateWorkflow(graph)).toEqual([
    { code: "workflow.invalid-config", params: { node: "a", issues: [{ path: "command", code: "invalid_type" }] } },
    { code: "workflow.invalid-config", params: { node: "b", issues: [{ path: "cwd", code: "invalid_format" }] } },
    { code: "workflow.invalid-config", params: { node: "d", issues: [{ path: "path", code: "invalid_format" }] } },
  ]);
});

test("A28: a workflow a schedule starts may not write a file; the same graph started by hand may", () => {
  const nodes = ["start:trigger.schedule", "w:file.write"];
  expect(validateWorkflow(workflow(nodes, ["start.start>w.run"]))).toEqual([
    { code: "workflow.report-only-write", params: { node: "w" } },
  ]);
  expect(validateWorkflow(workflow([start, "w:file.write"], ["start.start>w.run"]))).toEqual([]);
  // A schedule needs its cron and its precheck (Q13).
  expect(codes(workflow(["start:trigger.schedule:{}"], []))).toEqual(["workflow.invalid-config"]);
});
