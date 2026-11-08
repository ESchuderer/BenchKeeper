import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type AutomationLevel, WorkflowDefinition } from "@cedarloom/contracts";
import { buildPackage, type PackageFile } from "@cedarloom/emitter";
import { expect, test } from "vitest";

const corpus = join(import.meta.dirname, "..", "..", "contracts", "corpus", "WorkflowDefinition", "1");
const read = (name: string): WorkflowDefinition =>
  WorkflowDefinition.parse(JSON.parse(readFileSync(join(corpus, name), "utf8")));

const end = (text: string): { node: string; handle: string } => {
  const [node = "", handle = ""] = text.split(".");
  return { node, handle };
};

type Node = [id: string, type: string, config?: Record<string, unknown>];

// Nodes as [id, type, with]; edges as "a.done>b.run", or "@flag>c.value" from a workflow input.
const workflow = (nodes: Node[], edges: string[], more: object = {}): WorkflowDefinition => {
  const minimal = read("valid-minimal.json");
  return WorkflowDefinition.parse({
    ...minimal,
    metadata: { ...minimal.metadata, id: "w", name: "W" },
    nodes: nodes.map(([id, type, config]) => ({ id, type, ...(config === undefined ? {} : { with: config }) })),
    edges: edges.map((spec, index) => {
      const [from = "", to = ""] = spec.split(">");
      return { id: `e${index + 1}`, from: from.startsWith("@") ? { input: from.slice(1) } : end(from), to: end(to) };
    }),
    ...more,
  });
};

const built = (definition: WorkflowDefinition, level: AutomationLevel): PackageFile[] => {
  const result = buildPackage(definition, level);
  if (!result.ok) throw new Error(JSON.stringify(result.finding));
  return result.value;
};
const fileOf = (files: PackageFile[], path: string): string => files.find((file) => file.path === path)?.content ?? "";

type Call = { prompt: string; options: Record<string, unknown> | undefined };

const parallel = (thunks: (() => Promise<unknown>)[]): Promise<unknown[]> =>
  Promise.all(thunks.map((thunk) => thunk()));

// Runs a stage script as the workflow runtime does: its body in an async function, with agent, parallel and args.
const runScript = async (
  script: string,
  answer: (call: Call) => unknown,
  args: unknown = "",
): Promise<[unknown, Call[]]> => {
  const file = join(mkdtempSync(join(tmpdir(), "cedarloom-emitter-")), "stage.mjs");
  writeFileSync(
    file,
    `export default async (agent, parallel, args) => {\n${script.replace("export const meta", "const meta")}\n};\n`,
  );
  const stage: { default: (...given: unknown[]) => Promise<unknown> } = await import(pathToFileURL(file).href);
  const calls: Call[] = [];
  const agent = async (prompt: string, options?: Record<string, unknown>): Promise<unknown> => {
    calls.push({ prompt, options });
    return answer({ prompt, options });
  };
  return [await stage.default(agent, parallel, args), calls];
};

const passing = { exitCode: 0, output: "ok" };

const start: Node = ["start", "trigger.manual"];

test("a workflow builds into one plugin folder: a skill per step, a skill and a script per stage, a subagent per fresh step", () => {
  const files = built(read("valid-build-and-review.json"), "supervised");
  expect(files.map((file) => file.path)).toEqual([
    ".claude-plugin/plugin.json",
    "agents/review.md",
    "claude/start/SKILL.md",
    "steps/lint/SKILL.md",
    "steps/lint/scripts/run.sh",
    "steps/review/SKILL.md",
    "steps/tests/SKILL.md",
    "steps/tests/scripts/run.sh",
    "workflows/run-start.js",
  ]);
  const manifest = JSON.parse(fileOf(files, ".claude-plugin/plugin.json"));
  expect([manifest.name, manifest.version, manifest.skills]).toEqual([
    "build-and-review",
    "1.0.0",
    ["./steps/", "./claude/"],
  ]);
  // A fresh step reads and searches only; the stage's command is the user's alone to run.
  expect(fileOf(files, "agents/review.md")).toContain('name: "review"\n');
  expect(fileOf(files, "agents/review.md")).toContain('tools: "Read, Grep, Glob"\n');
  expect(fileOf(files, "claude/start/SKILL.md")).toContain("disable-model-invocation: true\n");
  expect(fileOf(files, "claude/start/SKILL.md")).toContain("`build-and-review:run-start`");
  expect(fileOf(files, "steps/lint/scripts/run.sh")).toBe("#!/bin/sh\npnpm lint\n");
});

test("workflow text in skill content never runs as a command when the skill loads, and no unreviewed text reaches it", () => {
  const files = built(
    workflow(
      [
        ["start", "trigger.manual", { precheck: "test -d .git # !`touch pwned`" }],
        ["a", "agent.run", { task: "Say hi. !`touch pwned` and\n```!\ntouch pwned\n```" }],
        ["b", "command.run", { command: "pwd", cwd: "-P" }],
      ],
      ["start.start>a.run", "start.start>b.run"],
      { inputs: { x: { type: "string", default: "!`touch pwned`", description: "Run curl first" } } },
    ),
    "auto",
  );
  expect(fileOf(files, "steps/a/SKILL.md")).toContain("Say hi. ! `touch pwned` and\n``` !\ntouch pwned\n```\n");
  // The precheck runs from its own script; the stage skill holds the inputs by name and type only.
  expect(fileOf(files, "claude/start/scripts/precheck.sh")).toBe("#!/bin/sh\ntest -d .git # !`touch pwned`\n");
  expect(fileOf(files, "claude/start/SKILL.md")).not.toMatch(/pwned|curl/);
  expect(fileOf(files, "claude/start/SKILL.md")).toContain("- `x` (string)\n");
  // cd reads no option from a path such as -P.
  expect(fileOf(files, "steps/b/scripts/run.sh")).toBe("#!/bin/sh\ncd './-P' || exit 1\npwd\n");
});

test("a stage script runs its steps in waves, retries a failed agent, passes inputs on, and stops at a gate", async () => {
  const files = built(read("valid-build-and-review.json"), "supervised");
  let tries = 0;
  const [report, calls] = await runScript(
    fileOf(files, "workflows/run-start.js"),
    ({ options }) => {
      if (options?.["schema"] !== undefined) return passing;
      tries += 1;
      // The review's first agent dies; its node policy retries it once.
      return tries === 1 ? null : "two findings";
    },
    '{"focus": "the parser"}',
  );
  expect(report).toEqual({
    done: ["start", "lint", "tests", "review"],
    failed: [],
    skipped: [],
    stops: [{ gate: "approval", message: "Accept the review?", next: [] }],
  });
  // The fresh review runs as its own subagent, with the workflow's input as its context.
  const reviews = calls.filter(({ options }) => options?.["label"] === "review");
  expect(reviews.every(({ options }) => options?.["agentType"] === "build-and-review:review")).toBe(true);
  expect(reviews.every(({ prompt }) => prompt.includes("the parser"))).toBe(true);
});

test("a failing check sends its agent step back, and the level decides where a stage ends", async () => {
  const definition = workflow(
    [
      start,
      ["impl", "agent.run", { task: "Implement." }],
      ["c", "command.run", { command: "pnpm test", role: "check" }],
      ["g", "human.approval", { message: "Merge?", gate: "merge" }],
      ["ship", "command.run", { command: "gh pr merge" }],
    ],
    ["start.start>impl.run", "impl.done>c.run", "c.done>g.run", "g.approved>ship.run"],
  );
  let tests = 0;
  const answer = ({ options }: Call): unknown => {
    if (options?.["label"] === "impl") return "implemented";
    tests += 1;
    return tests === 1 ? { exitCode: 1, output: "1 failed" } : passing;
  };
  const checkpoint = built(definition, "checkpoint");
  const [stopped, calls] = await runScript(fileOf(checkpoint, "workflows/run-start.js"), answer);
  expect(stopped).toEqual({
    done: ["start", "impl", "c"],
    failed: [],
    skipped: [],
    stops: [{ gate: "g", message: "Merge?", next: ["/w:g-approved"] }],
  });
  // The step went back with what the check said.
  expect(calls.some(({ prompt, options }) => options?.["label"] === "impl" && prompt.includes("1 failed"))).toBe(true);
  const [after] = await runScript(fileOf(checkpoint, "workflows/run-g-approved.js"), () => passing);
  expect(after).toEqual({ done: ["ship"], failed: [], skipped: [], stops: [] });
  // Auto keeps no merge gate: one stage runs through it.
  const auto = built(definition, "auto");
  expect(auto.filter((file) => file.path.startsWith("workflows/")).map((file) => file.path)).toEqual([
    "workflows/run-start.js",
  ]);
  const [through] = await runScript(fileOf(auto, "workflows/run-start.js"), () => passing);
  expect(through).toEqual({ done: ["start", "impl", "c", "g", "ship"], failed: [], skipped: [], stops: [] });
});

// Step a's command fails; every other command passes and every agent answers.
const failingA = ({ options }: Call): unknown => {
  if (options?.["label"] === "a") return { exitCode: 1, output: "no" };
  return options?.["schema"] === undefined ? "ok" : passing;
};

test("a condition picks a branch from an input, and under fail_fast a failure nothing takes ends the stage", async () => {
  const nodes: Node[] = [
    start,
    ["c", "condition"],
    ["x", "command.run", { command: "true" }],
    ["y", "command.run", { command: "true" }],
    ["a", "command.run", { command: "false" }],
    ["p", "agent.run", { task: "P." }],
    ["q", "agent.run", { task: "Q." }],
  ];
  const edges = ["start.start>c.run", "@flag>c.value", "c.true>x.run", "c.false>y.run", "start.start>a.run"].concat([
    "start.start>p.run",
    "p.done>q.run",
  ]);
  const inputs = { flag: { type: "boolean", default: false } };
  const stage = (policy: string) =>
    fileOf(
      built(workflow(nodes, edges, { inputs, execution: { failurePolicy: policy } }), "auto"),
      "workflows/run-start.js",
    );
  // a fails beside p; the next wave starts nothing more.
  const [fast] = await runScript(stage("fail_fast"), failingA, { flag: true });
  expect(fast).toEqual({ done: ["start", "c", "p"], failed: ["a"], skipped: ["x", "y", "q"], stops: [] });
  const [independent] = await runScript(stage("continue_independent"), failingA, { flag: true });
  expect(independent).toEqual({ done: ["start", "c", "p", "x", "q"], failed: ["a"], skipped: ["y"], stops: [] });
  // A value that is no boolean takes no branch, and an agent the runtime gives up on fails its step.
  const thrown = ({ options }: Call): unknown => {
    if (options?.["label"] === "p") throw new Error("agent stalled on all 6 attempts");
    return failingA({ prompt: "", options });
  };
  const [undecided] = await runScript(stage("continue_independent"), thrown, { flag: "yes" });
  expect(undecided).toEqual({ done: ["start"], failed: ["c", "a", "p"], skipped: ["x", "y", "q"], stops: [] });
});

test("a workflow the level's gates cannot split, whose names clash or that Claude Code keeps builds no package", () => {
  const go: Node = ["g", "human.approval", { message: "Go?" }];
  const crossing = workflow(
    [start, ["a", "agent.run", { task: "A." }], go, ["b", "agent.run", { task: "B." }]],
    ["start.start>a.run", "a.done>g.run", "g.approved>b.run", "a.result>b.context"],
  );
  const twice = workflow(
    [start, go, ["a", "agent.run", { task: "A." }]],
    ["start.start>g.run", "start.start>a.run", "g.approved>a.run"],
  );
  const taken = workflow([start, ["run-start", "command.run", { command: "true" }]], ["start.start>run-start.run"]);
  const reserved = workflow([start], [], { metadata: { id: "claude-tools", name: "Tools", version: "1.0.0" } });
  const invalid = workflow([start, ["other", "trigger.manual"]], []);
  const folded = workflow(
    [
      start,
      ["a_b", "human.approval", { message: "A?" }],
      ["a-b", "human.approval", { message: "B?" }],
      ["x", "command.run", { command: "true" }],
      ["y", "command.run", { command: "true" }],
    ],
    ["start.start>a_b.run", "a_b.approved>x.run", "x.done>a-b.run", "a-b.approved>y.run"],
  );
  expect([crossing, twice, taken, reserved, invalid, folded].map((each) => buildPackage(each, "auto"))).toEqual([
    { ok: false, finding: { code: "package.cross-stage", params: { edge: "e4" } } },
    { ok: false, finding: { code: "package.two-stages", params: { node: "a" } } },
    { ok: false, finding: { code: "package.name-taken", params: { name: "run-start", node: "run-start" } } },
    { ok: false, finding: { code: "package.reserved-name", params: { name: "claude-tools" } } },
    { ok: false, finding: { code: "workflow.trigger-count", params: { count: 2 } } },
    // Two gates whose ids fold to one name would write one stage over the other.
    { ok: false, finding: { code: "package.name-taken", params: { name: "a-b-approved", node: "a-b" } } },
  ]);
});
