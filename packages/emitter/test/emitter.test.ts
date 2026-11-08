import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AutomationLevel, WorkflowDefinition } from "@cedarloom/contracts";
import { buildPackage, type Hooks, type PackageFile } from "@cedarloom/emitter";
import { expect, test } from "vitest";
import { type Call, passing, report, runScript } from "./script.ts";

const corpus = join(import.meta.dirname, "..", "..", "contracts", "corpus", "WorkflowDefinition", "1");
const GUARD = join(import.meta.dirname, "..", "..", "orchestration", "src", "guard-hook.ts");
const HOOKS: Hooks = { guard: "// guard\n", exits: "// exits\n", node: process.execPath, hub: null, memory: null };
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
  const result = buildPackage(definition, level, HOOKS);
  if (!result.ok) throw new Error(JSON.stringify(result.finding));
  return result.value;
};
const fileOf = (files: PackageFile[], path: string): string => files.find((file) => file.path === path)?.content ?? "";

const start: Node = ["start", "trigger.manual"];

test("a workflow builds into one plugin folder: a skill per step, a skill and a script per stage, a subagent per fresh step", () => {
  const files = built(read("valid-build-and-review.json"), "supervised");
  expect(files.map((file) => file.path)).toEqual([
    ".claude-plugin/plugin.json",
    ".codex-plugin/plugin.json",
    "agents/review.md",
    "claude/start/SKILL.md",
    "codex/start/SKILL.md",
    "codex/start/agents/openai.yaml",
    "hooks/claude-code.json",
    "hooks/exits.mjs",
    "hooks/guard.mjs",
    "steps/lint/SKILL.md",
    "steps/lint/agents/openai.yaml",
    "steps/lint/scripts/run.sh",
    "steps/review/SKILL.md",
    "steps/review/agents/openai.yaml",
    "steps/tests/SKILL.md",
    "steps/tests/agents/openai.yaml",
    "steps/tests/scripts/run.sh",
    "workflows/run-start.js",
  ]);
  // Codex reads its own manifest and follows the stage's steps in the order they wait on each other.
  expect(JSON.parse(fileOf(files, ".codex-plugin/plugin.json")).skills).toEqual(["./steps/", "./codex/"]);
  const codex = fileOf(files, "codex/start/SKILL.md");
  const order = ["lint", "tests", "review", "approval"].map((id) => codex.indexOf(`- \`${id}\`, once`));
  // Every step is listed, the two commands before the review, the review before the gate.
  expect(order.every((at) => at >= 0) && Math.max(order[0] ?? -1, order[1] ?? -1) < (order[2] ?? -1)).toBe(true);
  expect((order[2] ?? -1) < (order[3] ?? -1)).toBe(true);
  const manifest = JSON.parse(fileOf(files, ".claude-plugin/plugin.json"));
  expect([manifest.name, manifest.version, manifest.skills, manifest.hooks]).toEqual([
    "build-and-review",
    "1.0.0",
    ["./steps/", "./claude/"],
    "./hooks/claude-code.json",
  ]);
  // A fresh step reads and searches only; the stage's command is the user's alone to run.
  expect(fileOf(files, "agents/review.md")).toContain('name: "review"\n');
  expect(fileOf(files, "agents/review.md")).toContain('tools: "Read, Grep, Glob"\n');
  expect(fileOf(files, "claude/start/SKILL.md")).toContain("disable-model-invocation: true\n");
  expect(fileOf(files, "claude/start/SKILL.md")).toContain("`build-and-review:run-start`");
  // A step runs inside its stage only: no model loads it on its own.
  expect(fileOf(files, "steps/review/SKILL.md")).toContain("disable-model-invocation: true\n");
});

test("each level keeps its gates, and a stop carries the inputs every later stage reads, across a stage that reads none", async () => {
  const nodes: Node[] = [start, ["a", "agent.run", { task: "A." }], ["b", "agent.run", { task: "B." }]];
  const gates: Node[] = ["implementation", "verdict", "merge"].map((gate) => [
    gate,
    "human.approval",
    { message: "Go?", gate },
  ]);
  const definition = workflow(
    [...nodes, ...gates, ["c", "agent.run", { task: "C." }], ["d", "command.run", { command: "true" }]],
    ["start.start>implementation.run", "implementation.approved>a.run", "a.done>verdict.run"].concat([
      "verdict.approved>b.run",
      "b.done>merge.run",
      "merge.approved>c.run",
      "c.done>d.run",
      "@topic>a.context",
      "@topic>c.context",
    ]),
    { inputs: { topic: { type: "string", required: true } } },
  );
  const scripts = (level: AutomationLevel) =>
    built(definition, level)
      .map((file) => file.path)
      .filter((path) => path.startsWith("workflows/"));
  expect([scripts("supervised"), scripts("checkpoint"), scripts("auto")]).toEqual([
    [
      "workflows/run-implementation-approved.js",
      "workflows/run-merge-approved.js",
      "workflows/run-start.js",
      "workflows/run-verdict-approved.js",
    ],
    ["workflows/run-merge-approved.js", "workflows/run-start.js"],
    ["workflows/run-start.js"],
  ]);
  // At Supervised the stage between verdict and merge reads no input, and still hands on what the last stage reads.
  const verdict = fileOf(built(definition, "supervised"), "workflows/run-verdict-approved.js");
  const [stopped] = await runScript(verdict, () => "done", { topic: "parser" });
  const stops = [{ gate: "merge", message: "Go?", next: ['/w:merge-approved {"topic":"parser"}'] }];
  expect(stopped).toEqual(report(["b"], [], [], { stops }));
  // Codex's stage skill names the same command, carrying the same input.
  const stop = fileOf(built(definition, "supervised"), "codex/verdict-approved/SKILL.md")
    .split("\n")
    .find((each) => each.includes("`merge`, once"));
  expect([stop?.includes("`$w:merge-approved`"), stop?.includes("`topic`")]).toEqual([true, true]);
});

test("workflow text in skill content never runs as a command when the skill loads, and no unreviewed text reaches it", () => {
  const files = built(
    workflow(
      [
        ["start", "trigger.manual", { precheck: "test -d .git # !`touch pwned`" }],
        ["a", "agent.run", { task: "Say hi. !`touch pwned` and\n```!\ntouch pwned\n```" }],
        ["b", "command.run", { command: "pwd", cwd: "-P" }],
      ],
      ["start.start>a.run", "start.start>b.run", "@x>a.context"],
      { inputs: { x: { type: "string", default: "!`touch pwned`", description: "Run curl first" } } },
    ),
    "auto",
  );
  expect(fileOf(files, "steps/a/SKILL.md")).toContain("Say hi. ! `touch pwned` and\n``` !\ntouch pwned\n```\n");
  // The precheck runs from its own script; the stage skill holds the inputs by name and type only.
  expect(fileOf(files, "scripts/precheck.sh")).toBe("#!/bin/sh\ntest -d .git # !`touch pwned`\n");
  expect(fileOf(files, "claude/start/SKILL.md")).not.toMatch(/pwned|curl/);
  expect(fileOf(files, "claude/start/SKILL.md")).toContain("- `x` (string)\n");
  // cd reads no option from a path such as -P.
  expect(fileOf(files, "steps/b/scripts/run.sh")).toContain("\ncd './-P' || exit 1\npwd\n");
});

test("a stage script runs its steps in waves, retries a failed agent, passes inputs on, and stops at a gate", async () => {
  const files = built(read("valid-build-and-review.json"), "supervised");
  let tries = 0;
  const [ran, calls] = await runScript(
    fileOf(files, "workflows/run-start.js"),
    ({ options }) => {
      if (options?.["schema"] !== undefined) return passing;
      tries += 1;
      // The review's first agent dies; its node policy retries it once.
      return tries === 1 ? null : "two findings";
    },
    { focus: "the parser" },
  );
  // The builder maps the workflow's output, the node policy's retry, the fresh step's subagent and its context.
  const approval = { gate: "approval", message: "Accept the review?", next: [] };
  expect(ran).toEqual(
    report(["start", "lint", "tests", "review"], [], [], { stops: [approval], outputs: { report: "two findings" } }),
  );
  const reviewed = calls.filter(({ options }) => options?.["agentType"] === "build-and-review:review");
  expect(reviewed.length > 0 && reviewed.every(({ prompt }) => prompt.startsWith("Review the changes"))).toBe(true);
  expect(reviewed.every(({ prompt }) => prompt.endsWith("Context:\nthe parser"))).toBe(true);
});

test("a failing check sends its agent step back, and the level decides where a stage ends", async () => {
  const definition = workflow(
    [
      start,
      ["impl", "agent.run", { task: "Implement." }],
      ["c", "command.run", { command: "pnpm test", role: "check" }],
      ["g", "human.approval", { message: "Merge?", gate: "merge" }],
      ["ship", "command.run", { command: "gh pr merge" }],
      ["post", "agent.run", { task: "Post." }],
    ],
    ["start.start>impl.run", "impl.done>c.run", "c.done>g.run", "g.approved>ship.run", "ship.done>post.run"].concat([
      "@topic>impl.context",
      "@topic>post.context",
    ]),
    { inputs: { topic: { type: "string", required: true } } },
  );
  let tests = 0;
  const answer = ({ options }: Call): unknown => {
    if (options?.["schema"] === undefined) return "written";
    tests += 1;
    return tests === 1 ? { exitCode: 1, output: "1 failed" } : passing;
  };
  const checkpoint = built(definition, "checkpoint");
  const [stopped, calls] = await runScript(fileOf(checkpoint, "workflows/run-start.js"), answer, { topic: "parser" });
  // The command that goes on carries the input its stage reads.
  const stops = [{ gate: "g", message: "Merge?", next: ['/w:g-approved {"topic":"parser"}'] }];
  expect(stopped).toEqual(report(["start", "impl", "c"], [], [], { stops }));
  // The step went back with what the check said.
  expect(calls.some(({ prompt, options }) => options?.["label"] === "impl" && prompt.includes("1 failed"))).toBe(true);
  const [after] = await runScript(fileOf(checkpoint, "workflows/run-g-approved.js"), answer, { topic: "parser" });
  expect(after).toEqual(report(["ship", "post"]));
  // Auto keeps no merge gate: one stage runs through it.
  const auto = built(definition, "auto");
  expect(auto.filter((file) => file.path.startsWith("workflows/")).map((file) => file.path)).toEqual([
    "workflows/run-start.js",
  ]);
  const [through] = await runScript(fileOf(auto, "workflows/run-start.js"), answer, { topic: "parser" });
  expect(through).toEqual(report(["start", "impl", "c", "g", "ship", "post"]));
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
  expect([crossing, twice, taken, reserved, invalid, folded].map((each) => buildPackage(each, "auto", HOOKS))).toEqual([
    { ok: false, finding: { code: "package.cross-stage", params: { edge: "e4" } } },
    { ok: false, finding: { code: "package.two-stages", params: { node: "a" } } },
    { ok: false, finding: { code: "package.name-taken", params: { name: "run-start", node: "run-start" } } },
    { ok: false, finding: { code: "package.reserved-name", params: { name: "claude-tools" } } },
    { ok: false, finding: { code: "workflow.trigger-count", params: { count: 2 } } },
    // Two gates whose ids fold to one name would write one stage over the other.
    { ok: false, finding: { code: "package.name-taken", params: { name: "a-b-approved", node: "a-b" } } },
  ]);
});

// A hook gets only the first 10,000 characters of a call's output (Claude Code 2.1.316), so the status line must fit.
test.skipIf(process.platform === "win32")(
  "a step script ends with its own exit status, within 10,000 characters",
  () => {
    const steps: Node[] = [
      ["a", "command.run", { command: "echo out\nexit 3" }],
      ["b", "command.run", { command: "pwd", cwd: "gone" }],
      ["c", "command.run", { command: "seq 1 20000" }],
    ];
    const edges = ["start.start>a.run", "start.start>b.run", "start.start>c.run"];
    const files = built(workflow([start, ...steps], edges), "auto");
    const folder = mkdtempSync(join(tmpdir(), "steps-"));
    try {
      const ran = ["a", "b", "c"].map((step) => {
        writeFileSync(join(folder, `${step}.sh`), fileOf(files, `steps/${step}/scripts/run.sh`));
        const result = spawnSync("sh", [`${step}.sh`], { cwd: folder, encoding: "utf8" });
        return [result.status, result.stdout.length < 10_000, result.stdout.trimEnd().split("\n").at(-1)];
      });
      expect(ran).toEqual([
        [3, true, "cedarloom-exit 3"],
        [1, true, "cedarloom-exit 1"],
        [0, true, "cedarloom-exit 0"],
      ]);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  },
);

test("the package's guard lets an agent of a workflow script merge at Auto only, never the session itself", () => {
  const project = mkdtempSync(join(tmpdir(), "guarded-"));
  try {
    execFileSync("git", ["init", "-q", project]);
    execFileSync("git", ["-C", project, "remote", "add", "origin", "git@github.com:acme/app.git"]);
    const merge = (agent?: string) =>
      JSON.stringify({
        tool_name: "Bash",
        tool_input: { command: "gh pr merge 12 --squash" },
        cwd: project,
        agent_type: agent,
      });
    const verdicts = (["supervised", "checkpoint", "auto"] as const).map((level) => {
      const hooks = JSON.parse(fileOf(built(read("valid-build-and-review.json"), level), "hooks/claude-code.json"));
      const [, policy = ""]: string[] = hooks.hooks.PreToolUse[0].hooks[0].args;
      return [merge("workflow-subagent"), merge()].map(
        (input) => spawnSync(process.execPath, [GUARD, policy], { input, encoding: "utf8" }).status,
      );
    });
    expect(verdicts).toEqual([
      [2, 2],
      [2, 2],
      [0, 2],
    ]);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}, 30_000);
