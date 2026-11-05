import { WorkflowDefinition } from "@cedarloom/contracts";
import { NODE_TYPES } from "@cedarloom/engine/graph";
import { validateWorkflow } from "@cedarloom/engine/validate";
import * as fc from "fast-check";
import { expect, test } from "vitest";
import {
  apply,
  canConnect,
  type Change,
  edit,
  type History,
  newWorkflow,
  open,
  redo,
  undo,
} from "../src/workflow/document.ts";
import { endsOf, INPUTS, isBoundary, OUTPUTS, project } from "../src/workflow/projection.ts";

const at = (x: number, y: number) => ({ x, y });
const node = (id: string, handle: string) => ({ node: id, handle });

/** A workflow with a trigger, a command and an agent, built by changes as the canvas builds it. */
const built = (): WorkflowDefinition => {
  const changes: Change[] = [
    { kind: "add-node", type: "command.run", position: at(240, 0) },
    { kind: "add-node", type: "agent.run", position: at(480, 0) },
    { kind: "connect", from: node("start", "start"), to: node("command-run-1", "run") },
  ];
  return changes.reduce(edit, newWorkflow());
};

test("a new workflow is a manual trigger, valid for the schema and the validator", () => {
  const workflow = newWorkflow();
  expect(WorkflowDefinition.parse(workflow)).toEqual(workflow);
  expect(validateWorkflow(workflow)).toEqual([]);
});

test("added nodes get the first free id of their type and a position in the layout section only", () => {
  const workflow = edit(built(), { kind: "add-node", type: "command.run", position: at(0, 200) });
  expect(workflow.nodes.map((item) => item.id)).toEqual(["start", "command-run-1", "agent-run-1", "command-run-2"]);
  expect(workflow.nodes.at(-1)).toEqual({ id: "command-run-2", type: "command.run" });
  expect(workflow.layout?.nodes["command-run-2"]).toEqual(at(0, 200));
  expect(workflow.edges).toEqual([{ id: "e1", from: node("start", "start"), to: node("command-run-1", "run") }]);
});

test("a connection is refused when a handle is missing, the types are incompatible, or the input is taken", () => {
  const workflow = built();
  const refused = [
    [node("command-run-1", "exitCode"), node("agent-run-1", "context")], // number into string
    [node("command-run-1", "done"), node("agent-run-1", "context")], // control into data
    [node("command-run-1", "nope"), node("agent-run-1", "run")],
    [node("gone", "done"), node("agent-run-1", "run")],
    [node("start", "start"), node("command-run-1", "run")], // the same edge again
    [{ input: "missing" }, node("agent-run-1", "context")],
  ] as const;
  for (const [from, to] of refused) expect([from, to, canConnect(workflow, from, to)]).toEqual([from, to, false]);
  const fed = edit(workflow, {
    kind: "connect",
    from: node("command-run-1", "stdout"),
    to: node("agent-run-1", "context"),
  });
  expect(canConnect(fed, node("command-run-1", "stdout"), node("agent-run-1", "context"))).toBe(false);
  // Control inputs take many sources; json into a typed input is allowed and checked when the run comes.
  expect(canConnect(workflow, node("command-run-1", "done"), node("agent-run-1", "run"))).toBe(true);
  const typed = {
    ...workflow,
    inputs: { data: { type: "json" as const } },
    outputs: { report: { type: "string" as const } },
  };
  expect(canConnect(typed, { input: "data" }, node("agent-run-1", "context"))).toBe(true);
  expect(canConnect(typed, node("agent-run-1", "result"), { output: "report" })).toBe(true);
  expect(edit(workflow, { kind: "connect", from: node("gone", "done"), to: node("agent-run-1", "run") })).toBe(
    workflow,
  );
});

test("a connection that would close a cycle is refused, a self-loop too", () => {
  const chained = edit(built(), {
    kind: "connect",
    from: node("command-run-1", "done"),
    to: node("agent-run-1", "run"),
  });
  expect(canConnect(chained, node("agent-run-1", "done"), node("command-run-1", "run"))).toBe(false);
  expect(canConnect(chained, node("agent-run-1", "failed"), node("agent-run-1", "run"))).toBe(false);
  expect(canConnect(chained, node("command-run-1", "failed"), node("agent-run-1", "run"))).toBe(true);
});

test("new nodes skip ids left in layout or execution; unknown types, unchanged moves and empty removes change nothing", () => {
  const stale: WorkflowDefinition = {
    ...newWorkflow(),
    layout: { nodes: { "join-1": { x: 0, y: 0, collapsed: true } } },
    execution: { nodes: { "join-2": { retries: 9 } } },
  };
  expect(edit(stale, { kind: "add-node", type: "join", position: at(1, 1) }).nodes.at(-1)?.id).toBe("join-3");
  expect(edit(stale, { kind: "add-node", type: "nope.unknown", position: at(1, 1) })).toBe(stale);
  const placed = edit(newWorkflow(), { kind: "move", positions: { start: at(5, 5) } });
  expect(edit(placed, { kind: "move", positions: { start: at(5, 5) } })).toBe(placed);
  expect(edit(placed, { kind: "remove", nodes: ["gone"], edges: ["e9"] })).toBe(placed);
});

test("removing a node removes its edges, position and policy; removing nothing or moving nothing changes nothing", () => {
  const withPolicy: WorkflowDefinition = {
    ...built(),
    execution: {
      failurePolicy: "fail_fast",
      nodes: { "command-run-1": { retries: 2 }, "agent-run-1": { retries: 1 } },
    },
  };
  const removed = edit(withPolicy, { kind: "remove", nodes: ["command-run-1"], edges: [] });
  expect(removed.nodes.map((item) => item.id)).toEqual(["start", "agent-run-1"]);
  expect([removed.edges, Object.keys(removed.layout?.nodes ?? {})]).toEqual([[], ["start", "agent-run-1"]]);
  expect(removed.execution).toEqual({ failurePolicy: "fail_fast", nodes: { "agent-run-1": { retries: 1 } } });
  expect(edit(withPolicy, { kind: "remove", nodes: [], edges: ["e1"] }).edges).toEqual([]);
  const lone = edit(withPolicy, { kind: "remove", nodes: ["command-run-1", "agent-run-1"], edges: [] });
  expect(edit(lone, { kind: "remove", nodes: ["start"], edges: [] })).toBe(lone);
  const { schemaVersion, kind, metadata } = newWorkflow();
  const bare: WorkflowDefinition = {
    schemaVersion,
    kind,
    metadata,
    nodes: [...newWorkflow().nodes, { id: "x", type: "join" }],
    edges: [],
  };
  expect(edit(bare, { kind: "remove", nodes: ["x"], edges: [] })).not.toHaveProperty("layout");
  expect(edit(withPolicy, { kind: "remove", nodes: [], edges: [] })).toBe(withPolicy);
  expect(edit(withPolicy, { kind: "move", positions: { gone: at(1, 1) } })).toBe(withPolicy);
});

test("moving keeps an editor's own keys of a layout entry, and the workflow stays valid", () => {
  const workflow = { ...built(), layout: { nodes: { "agent-run-1": { x: 0, y: 0, collapsed: true } } } };
  const moved = edit(workflow, { kind: "move", positions: { "agent-run-1": at(5, 6) } });
  expect(moved.layout?.nodes["agent-run-1"]).toEqual({ x: 5, y: 6, collapsed: true });
  // A move along one axis only is a move too.
  const down = edit(moved, { kind: "move", positions: { "agent-run-1": at(5, 9) } });
  expect(down.layout?.nodes["agent-run-1"]).toEqual({ x: 5, y: 9, collapsed: true });
  // Positions the schema cannot hold are refused.
  expect(edit(moved, { kind: "move", positions: { "agent-run-1": at(Number.NaN, 0) } })).toBe(moved);
  expect(edit(moved, { kind: "add-node", type: "join", position: at(0, Number.POSITIVE_INFINITY) })).toBe(moved);
  expect(WorkflowDefinition.parse(moved)).toEqual(moved);
  expect(edit(moved, { kind: "replace", workflow: newWorkflow() })).toEqual(newWorkflow());
  // A replacement the editor could not write back is refused: no nodes, or a position that is no finite number.
  expect(edit(moved, { kind: "replace", workflow: { ...newWorkflow(), nodes: [] } })).toBe(moved);
  const broken = { ...newWorkflow(), layout: { nodes: { start: at(Number.NaN, 0) } } };
  expect(edit(moved, { kind: "replace", workflow: broken })).toBe(moved);
});

test("the canvas shows every node at its layout position, the workflow's inputs and outputs at its edges", () => {
  const workflow: WorkflowDefinition = {
    ...built(),
    nodes: [...built().nodes, { id: "nope-1", type: "nope.unknown" }],
    inputs: { focus: { type: "string" } },
    outputs: { report: { type: "string" } },
    layout: { nodes: { "agent-run-1": at(480, 0) } },
  };
  workflow.edges.push(
    { id: "e2", from: { input: "focus" }, to: node("agent-run-1", "context") },
    { id: "e3", from: node("agent-run-1", "result"), to: { output: "report" } },
  );
  const { nodes, edges } = project(workflow);
  expect(nodes.map((item) => [item.id, item.position.x, item.position.y])).toEqual([
    [INPUTS, -240, 0],
    [OUTPUTS, 720, 0],
    ["start", 0, 160],
    ["command-run-1", 240, 160],
    ["agent-run-1", 480, 0],
    ["nope-1", 480, 160],
  ]);
  expect(nodes.find((item) => item.id === "agent-run-1")?.data).toEqual({
    type: "agent.run",
    inputs: [
      { name: "run", type: "control" },
      { name: "context", type: "string" },
    ],
    outputs: [
      { name: "done", type: "control" },
      { name: "failed", type: "control" },
      { name: "result", type: "string" },
    ],
  });
  expect(nodes.find((item) => item.id === "nope-1")?.data).toEqual({
    type: "nope.unknown",
    inputs: [],
    outputs: [],
  });
  expect(edges).toEqual([
    { id: "e1", source: "start", sourceHandle: "start", target: "command-run-1", targetHandle: "run" },
    { id: "e2", source: INPUTS, sourceHandle: "focus", target: "agent-run-1", targetHandle: "context" },
    { id: "e3", source: "agent-run-1", sourceHandle: "result", target: OUTPUTS, targetHandle: "report" },
  ]);
  expect(project(newWorkflow()).nodes.map((item) => item.id)).toEqual(["start"]);
  expect(nodes.filter((item) => isBoundary(item.id)).map((item) => item.id)).toEqual([INPUTS, OUTPUTS]);
});

test("a canvas connection maps back to the edge ends it names", () => {
  expect(endsOf({ source: INPUTS, sourceHandle: "focus", target: "a", targetHandle: "context" })).toEqual({
    from: { input: "focus" },
    to: node("a", "context"),
  });
  expect(endsOf({ source: "a", sourceHandle: "result", target: OUTPUTS, targetHandle: "report" })).toEqual({
    from: node("a", "result"),
    to: { output: "report" },
  });
  expect(endsOf({ source: "a", sourceHandle: null, target: "b", targetHandle: "run" })).toBeUndefined();
});

// Edits as indices, resolved against the workflow they apply to: a node type, or nodes, edges and handles by position.
type Intent =
  | { op: "add"; type: string; x: number }
  | { op: "connect"; a: number; b: number; h: number; k: number }
  | { op: "connect-in"; i: number; b: number; k: number }
  | { op: "connect-out"; a: number; h: number; o: number }
  | { op: "remove"; a: number }
  | { op: "cut"; e: number }
  | { op: "move"; a: number; x: number; y: number };

const anIntent: fc.Arbitrary<Intent> = fc.oneof(
  fc.record({ op: fc.constant("add" as const), type: fc.constantFrom(...Object.keys(NODE_TYPES)), x: fc.integer() }),
  fc.record({ op: fc.constant("connect" as const), a: fc.nat(), b: fc.nat(), h: fc.nat(), k: fc.nat() }),
  fc.record({ op: fc.constant("connect-in" as const), i: fc.nat(), b: fc.nat(), k: fc.nat() }),
  fc.record({ op: fc.constant("connect-out" as const), a: fc.nat(), h: fc.nat(), o: fc.nat() }),
  fc.record({ op: fc.constant("remove" as const), a: fc.nat() }),
  fc.record({ op: fc.constant("cut" as const), e: fc.nat() }),
  fc.record({ op: fc.constant("move" as const), a: fc.nat(), x: fc.integer(), y: fc.integer() }),
);

/** The start of each run: inputs and outputs, and keys of an editor's own in metadata and layout. */
const rich = (): WorkflowDefinition => ({
  ...newWorkflow(),
  metadata: { id: "workflow", name: "Workflow", version: "0.1.0", owner: "team-a" },
  inputs: { flag: { type: "boolean" }, text: { type: "string" }, data: { type: "json" } },
  outputs: { report: { type: "string" }, all: { type: "json" } },
  layout: { nodes: {}, viewport: { zoom: 1 } },
});

const pick = <T>(items: T[], index: number): T | undefined => items[index % Math.max(items.length, 1)];

// The handle names of a node, its outputs or its inputs; none for a missing node.
const handleNames = (item: { type: string } | undefined, side: "inputs" | "outputs"): string[] =>
  Object.keys((item === undefined ? undefined : NODE_TYPES[item.type])?.[side] ?? {});

const handleOf = (workflow: WorkflowDefinition, index: number, handle: number, side: "inputs" | "outputs") => {
  const item = pick(workflow.nodes, index);
  return node(item?.id ?? "", pick(handleNames(item, side), handle) ?? "");
};

const connectOf = (workflow: WorkflowDefinition, intent: Intent): Change => {
  const inputs = Object.keys(workflow.inputs ?? {});
  const outputs = Object.keys(workflow.outputs ?? {});
  if (intent.op === "connect-in") {
    return {
      kind: "connect",
      from: { input: pick(inputs, intent.i) ?? "" },
      to: handleOf(workflow, intent.b, intent.k, "inputs"),
    };
  }
  if (intent.op === "connect-out") {
    return {
      kind: "connect",
      from: handleOf(workflow, intent.a, intent.h, "outputs"),
      to: { output: pick(outputs, intent.o) ?? "" },
    };
  }
  const { a, b, h, k } = intent.op === "connect" ? intent : { a: 0, b: 0, h: 0, k: 0 };
  return { kind: "connect", from: handleOf(workflow, a, h, "outputs"), to: handleOf(workflow, b, k, "inputs") };
};

// The id of the node or edge an index picks; "" when there is none, which every edit refuses.
const idOf = (items: { id: string }[], index: number): string => pick(items, index)?.id ?? "";

const resolve = (workflow: WorkflowDefinition, intent: Intent): Change => {
  if (intent.op === "add") return { kind: "add-node", type: intent.type, position: at(intent.x, 0) };
  if (intent.op === "cut") return { kind: "remove", nodes: [], edges: [idOf(workflow.edges, intent.e)] };
  if (intent.op === "remove") return { kind: "remove", nodes: [idOf(workflow.nodes, intent.a)], edges: [] };
  if (intent.op === "move")
    return { kind: "move", positions: { [idOf(workflow.nodes, intent.a)]: at(intent.x, intent.y) } };
  return connectOf(workflow, intent);
};

/** Applies the edits and keeps a deep copy of the workflow after each one that took: a write into history shows. */
const run = (steps: Intent[]): { history: History; states: WorkflowDefinition[] } => {
  let history = open(rich());
  const states = [structuredClone(history.present)];
  for (const step of steps) {
    const next = apply(history, resolve(history.present, step));
    if (next !== history) states.push(structuredClone(next.present));
    history = next;
  }
  return { history, states };
};

test("every edit is one step that undo and redo walk exactly, and an editor's own keys survive each edit", () => {
  fc.assert(
    fc.property(fc.array(anIntent, { maxLength: 30 }), (steps) => {
      const { history, states } = run(steps);
      for (const state of states) {
        expect(WorkflowDefinition.parse(state)).toEqual(state);
        expect([state.metadata["owner"], state.layout?.["viewport"]]).toEqual(["team-a", { zoom: 1 }]);
      }
      let walk = history;
      for (const state of states.toReversed()) {
        expect(walk.present).toEqual(state);
        walk = undo(walk);
      }
      expect(walk.past).toEqual([]);
      for (const state of states) {
        expect(walk.present).toEqual(state);
        walk = redo(walk);
      }
      expect(walk).toEqual(history);
    }),
  );
});

// The validator's findings about edges themselves: canConnect allows an edge exactly when it adds none of them.
const EDGE_FINDINGS = new Set([
  "workflow.dangling-edge",
  "workflow.unknown-handle",
  "workflow.incompatible-handles",
  "workflow.many-sources",
  "workflow.cycle",
  "workflow.duplicate-edge",
]);
const edgeFindings = (workflow: WorkflowDefinition): string[] =>
  validateWorkflow(workflow).flatMap((finding) => (EDGE_FINDINGS.has(finding.code) ? [JSON.stringify(finding)] : []));

const candidates = (workflow: WorkflowDefinition) => ({
  outs: [
    ...Object.keys(workflow.inputs ?? {}).map((name) => ({ input: name })),
    ...workflow.nodes.flatMap((item) => handleNames(item, "outputs").map((name) => node(item.id, name))),
  ],
  ins: [
    ...Object.keys(workflow.outputs ?? {}).map((name) => ({ output: name })),
    ...workflow.nodes.flatMap((item) => handleNames(item, "inputs").map((name) => node(item.id, name))),
  ],
});

test("canConnect allows exactly the edges that give the validator no new finding about edges", () => {
  fc.assert(
    fc.property(fc.array(anIntent, { maxLength: 10 }), (steps) => {
      const workflow = run(steps).history.present;
      const before = new Set(edgeFindings(workflow));
      const { outs, ins } = candidates(workflow);
      for (const [from, to] of outs.flatMap((out) => ins.map((into) => [out, into] as const))) {
        const added = { ...workflow, edges: [...workflow.edges, { id: "probe", from, to }] };
        const fresh = edgeFindings(added).some((finding) => !before.has(finding));
        expect([from, to, canConnect(workflow, from, to)]).toEqual([from, to, !fresh]);
      }
    }),
    { numRuns: 30 },
  );
});

test("an edit past the schema's bounds is refused: 1,000 nodes, 5,000 edges", () => {
  const full = {
    ...newWorkflow(),
    nodes: Array.from({ length: 1000 }, (_, index) => ({ id: index === 0 ? "start" : `n${index}`, type: "join" })),
  };
  expect(edit(full, { kind: "add-node", type: "join", position: at(0, 0) })).toBe(full);
  // The bounds are the schema's: 1,000 nodes parse, 1,001 do not.
  expect(WorkflowDefinition.safeParse(full).success).toBe(true);
  const over = { ...full, nodes: [...full.nodes, { id: "over", type: "join" }] };
  expect(WorkflowDefinition.safeParse(over).success).toBe(false);
  const edges = Array.from({ length: 5000 }, (_, index) => ({
    id: `e${index}`,
    from: { input: "x" },
    to: { output: "y" },
  }));
  expect(canConnect({ ...built(), edges }, node("start", "start"), node("agent-run-1", "run"))).toBe(false);
});

test("undo and redo at their ends change nothing; a new edit drops the redo steps; at most 100 steps are kept", () => {
  const start = open(newWorkflow());
  expect([undo(start), redo(start)]).toEqual([start, start]);
  const added = apply(start, { kind: "add-node", type: "join", position: at(0, 0) });
  const branched = apply(undo(added), { kind: "add-node", type: "condition", position: at(0, 0) });
  expect([branched.future, branched.present.nodes.at(-1)?.type]).toEqual([[], "condition"]);
  const many = Array.from({ length: 120 }, (_, x) => x).reduce(
    (history: History, x) => apply(history, { kind: "move", positions: { start: at(x + 1, 0) } }),
    start,
  );
  expect(many.past.length).toBe(100);
  // The oldest steps go: the first kept one is the state after move 20.
  expect(many.past[0]?.layout?.nodes["start"]).toEqual(at(20, 0));
  expect(apply(start, { kind: "remove", nodes: [], edges: [] })).toBe(start);
});
