import type { AutomationLevel, Result, WorkflowDefinition } from "@cedarloom/contracts";
import { endType } from "@cedarloom/engine/graph";
import type { Source, StageScript, Step } from "./runner.ts";

type Node = WorkflowDefinition["nodes"][number];
type Edge = WorkflowDefinition["edges"][number];

/** The gates each level keeps (owner, 2026-11-05): Supervised all three, Checkpoint the merge, Auto none. */
const KEPT: Record<AutomationLevel, readonly string[]> = {
  supervised: ["implementation", "verdict", "merge"],
  checkpoint: ["merge"],
  auto: [],
};

/** Whether a node is a gate the level keeps; an approval without a gate stops at every level. */
const keeps = (node: Node, level: AutomationLevel): boolean => {
  const gate = node.with?.["gate"];
  return node.type === "human.approval" && (typeof gate !== "string" || KEPT[level].includes(gate));
};

/** A name from an id: lower case, each run of other characters one hyphen. */
export const nameOf = (id: string): string =>
  id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** A step's skill folder: an agent step's `skill` or its id in lower case (the validator checked both), else from its id. */
export const skillOf = (node: Node): string => {
  const skill = node.with?.["skill"];
  if (typeof skill === "string") return skill;
  return node.type === "agent.run" ? node.id.toLowerCase() : nameOf(node.id);
};

/** A stage: the steps between the gates the level keeps; the first starts at the trigger, each other at a gate's output. */
export type Stage = { name: string; from: { node: string; handle: "approved" | "rejected" } | null; nodes: Node[] };

const fromNode = (edge: Edge): string | null => ("node" in edge.from ? edge.from.node : null);
const toNode = (edge: Edge): string | null => ("node" in edge.to ? edge.to.node : null);

/** The stages of a workflow at a level, or why it builds no package. */
export const stagesOf = (workflow: WorkflowDefinition, level: AutomationLevel): Result<Stage[]> => {
  const control = workflow.edges.filter((edge) => endType(workflow, edge.to, "to") === "control");
  const kept = workflow.nodes.filter((node) => keeps(node, level));
  const trigger = workflow.nodes.find((node) => node.type.startsWith("trigger."));
  const starts = [
    { name: "start", from: null, first: trigger === undefined ? [] : [trigger.id] },
    ...kept.flatMap((gate) =>
      (["approved", "rejected"] as const).map((handle) => ({
        // At most 64 characters, as a skill name, with the script's "run-" too.
        name: `${nameOf(gate.id).slice(0, 51).replace(/-$/, "")}-${handle}`,
        from: { node: gate.id, handle },
        first: control.flatMap((edge) =>
          "node" in edge.from && edge.from.node === gate.id && edge.from.handle === handle ? [toNode(edge) ?? ""] : [],
        ),
      })),
    ),
  ].filter((start) => start.first.length > 0);
  const owner = new Map<string, string>();
  for (const start of starts) {
    const queue = [...new Set(start.first)];
    for (const id of queue) {
      const other = owner.get(id);
      if (other !== undefined && other !== start.name) {
        return { ok: false, finding: { code: "package.two-stages", params: { node: id } } };
      }
      owner.set(id, start.name);
      if (kept.some((gate) => gate.id === id)) continue;
      const next = control.flatMap((edge) => (fromNode(edge) === id ? [toNode(edge) ?? ""] : []));
      queue.push(...next.filter((each) => each !== "" && !queue.includes(each)));
    }
  }
  const crossing = workflow.edges.find((edge) => {
    const [from, to] = [fromNode(edge), toNode(edge)];
    return from !== null && to !== null && !control.includes(edge) && owner.get(from) !== owner.get(to);
  });
  if (crossing !== undefined)
    return { ok: false, finding: { code: "package.cross-stage", params: { edge: crossing.id } } };
  const stages = starts.map(({ name, from }) => ({
    name,
    from,
    nodes: workflow.nodes.filter((node) => owner.get(node.id) === name),
  }));
  return { ok: true, value: stages };
};

/** The workflow inputs a stage's nodes read. */
export const inputsOf = (workflow: WorkflowDefinition, stage: Stage): string[] => {
  const ids = new Set(stage.nodes.map((node) => node.id));
  return [
    ...new Set(
      workflow.edges.flatMap((edge) => ("input" in edge.from && ids.has(toNode(edge) ?? "") ? [edge.from.input] : [])),
    ),
  ];
};

const sourceOf = (edge: Edge): Source =>
  "input" in edge.from ? { input: edge.from.input } : { output: `${edge.from.node}.${edge.from.handle}` };

const KINDS: Record<string, Step["kind"]> = {
  "trigger.manual": "start",
  "agent.run": "agent",
  condition: "condition",
  join: "join",
};

/** What a stage's script runs: each node of the stage as a step. */
export const scriptOf = (
  workflow: WorkflowDefinition,
  stage: Stage,
  { plugin, level, nextOf }: { plugin: string; level: AutomationLevel; nextOf: (gate: string) => Next[] },
): StageScript => {
  const into = (id: string): Edge[] => workflow.edges.filter((edge) => toNode(edge) === id);
  const inStage = new Set(stage.nodes.map((node) => node.id));
  const policy = (id: string) => workflow.execution?.nodes?.[id];
  // Each agent step's checks: the check nodes its `done` starts.
  const checks = new Map<string, string[]>();
  for (const check of stage.nodes.filter((node) => node.with?.["role"] === "check")) {
    for (const edge of into(check.id)) {
      if ("node" in edge.from) checks.set(edge.from.node, [...(checks.get(edge.from.node) ?? []), check.id]);
    }
  }
  const steps = stage.nodes.map((node): Step => {
    const edges = into(node.id);
    const isCheck = node.type === "command.run" && node.with?.["role"] === "check";
    const step: Step = {
      id: node.id,
      kind: kindOf(node, level, isCheck),
      after: [...new Set(edges.flatMap((edge) => fromNode(edge) ?? []))].filter((id) => inStage.has(id)),
      run: edges.filter((edge) => endType(workflow, edge.to, "to") === "control").map((edge) => keyOf(edge)),
      handled: workflow.edges.some(
        (edge) => "node" in edge.from && edge.from.node === node.id && edge.from.handle === "failed",
      ),
      failFast: (policy(node.id)?.failurePolicy ?? workflow.execution?.failurePolicy ?? "fail_fast") === "fail_fast",
    };
    const context = { plugin, retries: policy(node.id)?.retries, nextOf, checks: checks.get(node.id) ?? [] };
    return { ...step, ...detailsOf(node, edges, context) };
  });
  const defaults = Object.fromEntries(
    Object.entries(workflow.inputs ?? {}).flatMap(([name, input]) =>
      input.default === undefined ? [] : [[name, input.default]],
    ),
  );
  const from = stage.from === null ? [] : [stage.from];
  return {
    steps,
    fired: from.map(({ node, handle }) => `${node}.${handle}`),
    settled: from.map(({ node }) => node),
    defaults,
    required: inputsOf(workflow, stage).filter((name) => workflow.inputs?.[name]?.required === true),
    concurrency: workflow.execution?.maxConcurrency ?? 64,
    outputs: Object.fromEntries(
      workflow.edges.flatMap((edge) =>
        "output" in edge.to && inStage.has(fromNode(edge) ?? "") ? [[edge.to.output, sourceOf(edge)]] : [],
      ),
    ),
  };
};

const keyOf = (edge: Edge): string =>
  "node" in edge.from ? `${edge.from.node}.${edge.from.handle}` : `@${edge.from.input}`;

const kindOf = (node: Node, level: AutomationLevel, isCheck: boolean): Step["kind"] => {
  if (node.type === "command.run") return isCheck ? "check" : "command";
  if (node.type === "human.approval") return keeps(node, level) ? "stop" : "pass";
  return KINDS[node.type] ?? "start";
};

/** A command that goes on after a gate, and the inputs its stage reads. */
export type Next = { command: string; inputs: string[] };

type Context = {
  plugin: string;
  retries: number | undefined;
  nextOf: (gate: string) => Next[];
  checks: string[];
};

/** A text field of a node's configuration; the validator checked its type. */
export const textIn = (node: Node, key: string): string => {
  const value = node.with?.[key];
  return typeof value === "string" ? value : "";
};

const onto = (edges: Edge[], handle: string): Source | undefined => {
  const edge = edges.find((each) => "node" in each.to && each.to.handle === handle);
  return edge === undefined ? undefined : sourceOf(edge);
};

// An agent step's prompt, options, checks, context and retries.
const agentDetails = (node: Node, edges: Edge[], { plugin, retries, checks }: Context): Partial<Step> => {
  const config = node.with ?? {};
  const options = {
    label: node.id,
    ...(typeof config["model"] === "string" ? { model: config["model"] } : {}),
    ...(typeof config["effort"] === "string" ? { effort: config["effort"] } : {}),
    ...(config["fresh"] === true || config["tools"] !== undefined ? { agentType: `${plugin}:${skillOf(node)}` } : {}),
  };
  const context = onto(edges, "context");
  return {
    prompt: textIn(node, "task"),
    options,
    checks,
    ...(context === undefined ? {} : { context }),
    ...(retries === undefined ? {} : { retries }),
  };
};

// The fields of a step its kind needs.
const detailsOf = (node: Node, edges: Edge[], context: Context): Partial<Step> => {
  if (node.type === "agent.run") return agentDetails(node, edges, context);
  if (node.type === "command.run") {
    const script = `steps/${skillOf(node)}/scripts/run.sh`;
    return context.retries === undefined ? { script } : { script, retries: context.retries };
  }
  if (node.type === "human.approval") return { message: textIn(node, "message"), next: context.nextOf(node.id) };
  const value = onto(edges, "value");
  return node.type === "condition" && value !== undefined ? { value } : {};
};
