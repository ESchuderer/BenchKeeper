import type { WorkflowDefinition } from "@cedarloom/contracts";
import ELK from "elkjs/lib/main.js";
import { expect, test } from "vitest";
import { sources, targets } from "../src/workflow/connections.ts";
import { type Change, edit, newWorkflow } from "../src/workflow/document.ts";
import { autoLayout, elkGraph } from "../src/workflow/layout.ts";

const node = (id: string, handle: string) => ({ node: id, handle });

/** A trigger, a command after it and an agent after that, with a workflow input and output wired in. */
const chain = (): WorkflowDefinition => {
  const workflow: WorkflowDefinition = {
    ...newWorkflow(),
    inputs: { focus: { type: "string", required: true } },
    outputs: { report: { type: "string" } },
  };
  const changes: Change[] = [
    { kind: "add-node", type: "command.run", position: { x: 0, y: 0 } },
    { kind: "add-node", type: "agent.run", position: { x: 0, y: 0 } },
    { kind: "connect", from: node("start", "start"), to: node("command-run-1", "run") },
    { kind: "connect", from: node("command-run-1", "done"), to: node("agent-run-1", "run") },
    { kind: "connect", from: { input: "focus" }, to: node("agent-run-1", "context") },
    { kind: "connect", from: node("agent-run-1", "result"), to: { output: "report" } },
  ];
  return changes.reduce(edit, workflow);
};

test("the ELK graph has a port per handle, inputs west and outputs east, and edges between existing handles only", () => {
  const workflow = { ...chain(), nodes: [...chain().nodes, { id: "start", type: "join" }] };
  workflow.edges.push({ id: "bad", from: node("start", "nope"), to: node("command-run-1", "run") });
  const graph = elkGraph(workflow, { start: { width: 120, height: 60 } });
  expect(graph.children?.map((child) => [child.id, child.width, child.height])).toEqual([
    ["start", 120, 60],
    ["command-run-1", 200, 56 + 26 * 5],
    ["agent-run-1", 200, 56 + 26 * 5],
  ]);
  const command = graph.children?.find((child) => child.id === "command-run-1");
  expect(
    command?.ports?.map((port) => [port.id.split("\u0000").slice(1).join(" "), port.layoutOptions?.["elk.port.side"]]),
  ).toEqual([
    ["in run", "WEST"],
    ["out done", "EAST"],
    ["out failed", "EAST"],
    ["out stdout", "EAST"],
    ["out exitCode", "EAST"],
  ]);
  // The edges from the workflow input and to the workflow output, and the one to a missing handle, are left out.
  expect(graph.edges?.map((edge) => edge.id)).toEqual(["e1", "e2"]);
});

test("auto layout places the nodes left to right along their edges, at whole-number positions", async () => {
  // The Node entry runs ELK in process; its constructor is the module's default of the default (ELK.default = ELK).
  const positions = await autoLayout(new ELK.default(), chain(), {});
  expect(Object.keys(positions)).toEqual(["start", "command-run-1", "agent-run-1"]);
  const xs = Object.values(positions).map((position) => position.x);
  expect(xs).toEqual(xs.toSorted((a, b) => a - b));
  expect(new Set(xs).size).toBe(3);
  expect(Object.values(positions).every(({ x, y }) => Number.isInteger(x) && Number.isInteger(y))).toBe(true);
  // A node ELK leaves without coordinates goes to the origin; a graph without children gives no positions.
  const stub = { layout: async (graph: { id?: string }) => ({ id: graph.id ?? "", children: [{ id: "start" }] }) };
  expect(await autoLayout(stub, chain(), {})).toEqual({ start: { x: 0, y: 0 } });
  expect(await autoLayout({ layout: async () => ({ id: "w" }) }, chain(), {})).toEqual({});
});

test("a node of an unknown type is laid out with a small size and no ports, and offers no handles", () => {
  const odd = { ...newWorkflow(), nodes: [...newWorkflow().nodes, { id: "x", type: "nope.unknown" }] };
  const unknown = elkGraph(odd, {}).children?.find((child) => child.id === "x");
  expect([unknown?.height, unknown?.ports]).toEqual([56, []]);
  expect(sources(odd).map((item) => item.label)).toEqual(["start · start (control)"]);
  expect(targets(odd, node("start", "start"))).toEqual([]);
});

test("the keyboard dialog offers every output, and for each only the inputs canConnect allows", () => {
  const workflow = chain();
  const labels = sources(workflow).map((item) => item.label);
  expect(labels.slice(0, 2)).toEqual(["start · start (control)", "command-run-1 · done (control)"]);
  expect(labels.at(-1)).toBe("Workflow input focus (string)");
  // From the command's stdout (string): the agent's context is taken by the workflow input, the report output by
  // the agent's result, so no input is left.
  expect(targets(workflow, node("command-run-1", "stdout"))).toEqual([]);
  const open = { ...workflow, edges: workflow.edges.filter((edge) => edge.id !== "e4") };
  expect(targets(open, node("command-run-1", "stdout")).map((item) => item.label)).toEqual([
    "Workflow output report (string)",
  ]);
  const runs = targets(workflow, node("start", "start")).map((item) => item.label);
  expect(runs).toEqual(["agent-run-1 · run (control)"]);
});

test("a workflow with two nodes of one id offers the handles of the first node of that id, each once", () => {
  // The validator reports the duplicate id; the dialog's lists still need one value per option.
  const twice = { ...newWorkflow(), nodes: [...newWorkflow().nodes, { id: "start", type: "trigger.manual" }] };
  const values = sources(twice).map((item) => item.value);
  expect(values).toEqual([...new Set(values)]);
  expect(sources(twice).map((item) => item.label)).toEqual(["start · start (control)"]);
  expect(elkGraph(twice, {}).children?.map((child) => child.id)).toEqual(["start"]);
});
