import { type StageScript, type Step, stageScript } from "@cedarloom/emitter";
import { expect, test } from "vitest";
import { type Call, passing, report, runScript as runText } from "./script.ts";

// Runs a stage as its written script.
const runScript = (stage: StageScript, answer: (call: Call) => unknown, inputs: object = {}) =>
  runText(stageScript({ name: "run-start", description: "W: the stage start" }, stage), answer, inputs);

// A step that runs once the outputs `run` names fired, after their nodes settled.
const step = (id: string, kind: Step["kind"], run: string[] = [], more: Partial<Step> = {}): Step => ({
  id,
  kind,
  run,
  after: run.map((key) => key.split(".")[0] ?? ""),
  failFast: true,
  ...more,
});
const stageOf = (steps: Step[], more: Partial<StageScript> = {}): StageScript => ({
  steps,
  fired: [],
  settled: [],
  defaults: {},
  required: [],
  concurrency: 64,
  outputs: {},
  ...more,
});
const isCommand = ({ options }: Call): boolean => options?.["schema"] !== undefined;

// Every check fails; every agent answers.
const never = (call: Call): unknown => (isCommand(call) ? { exitCode: 1, output: "1 failed" } : "written");

// Step a's command fails; every other command passes and every agent answers.
const failingA = (call: Call): unknown => {
  if (call.prompt.includes("/plugin/a'")) return { exitCode: 1, output: "no" };
  return isCommand(call) ? passing : "ok";
};

test("a stage runs in waves, retries a failed agent, gives it its context, and stops at a gate with its outputs", async () => {
  const stage = stageOf(
    [
      step("start", "start"),
      step("lint", "command", ["start.start"], { script: "steps/lint/scripts/run.sh" }),
      step("tests", "command", ["start.start"], { script: "steps/tests/scripts/run.sh" }),
      step("review", "agent", ["lint.done", "tests.done"], {
        prompt: "Review.",
        context: { input: "focus" },
        retries: 1,
        options: { label: "review", agentType: "w:review" },
      }),
      step("gate", "stop", ["review.done"], {
        message: "Accept the review?",
        next: [{ command: "/w:gate-approved", inputs: ["focus"] }],
      }),
    ],
    { required: ["focus"], outputs: { report: { output: "review.result" } } },
  );
  let tries = 0;
  const answer = (call: Call): unknown => {
    if (isCommand(call)) return passing;
    tries += 1;
    // The review's first agent stalls on every attempt and throws; its retry runs it again.
    if (tries === 1) throw new Error("agent stalled on all 6 attempts");
    return "two findings";
  };
  const [ran, calls] = await runScript(stage, answer, { focus: "the parser" });
  // The command that goes on carries the input its stage reads; the gate shows the work it asks about.
  const stops = [{ gate: "gate", message: "Accept the review?", next: ['/w:gate-approved {"focus":"the parser"}'] }];
  expect(ran).toEqual(
    report(["start", "lint", "tests", "review"], [], [], { stops, outputs: { report: "two findings" } }),
  );
  expect(calls.some(({ prompt }) => prompt.includes("sh '/plugin/steps/lint/scripts/run.sh'"))).toBe(true);
  const reviews = calls.filter(({ options }) => options?.["label"] === "review");
  expect(
    reviews.every(({ options, prompt }) => options?.["agentType"] === "w:review" && prompt.includes("the parser")),
  ).toBe(true);
  // A required input the run does not give ends it before any step.
  await expect(runScript(stage, answer)).rejects.toThrow("The workflow needs the inputs focus.");
});

test("a failing check sends its agent step back with what it said, and a check still failing after three rounds fails", async () => {
  const steps = [
    step("start", "start"),
    step("impl", "agent", ["start.start"], { prompt: "Implement.", checks: ["c"], options: { label: "impl" } }),
    step("c", "check", ["impl.done"], { script: "steps/c/scripts/run.sh" }),
  ];
  let checked = 0;
  const once = (call: Call): unknown => {
    if (!isCommand(call)) return "written";
    checked += 1;
    return checked === 1 ? { exitCode: 1, output: "1 failed" } : passing;
  };
  const [passed, calls] = await runScript(stageOf(steps), once);
  expect(passed).toEqual(report(["start", "impl", "c"]));
  expect(calls.some(({ prompt, options }) => options?.["label"] === "impl" && prompt.includes("1 failed"))).toBe(true);
  const [failed] = await runScript(stageOf(steps), never);
  expect(failed).toEqual(report(["start"], ["impl", "c"]));
  // A check's own retries run first: a flaky check passing on its retry never sends the step back.
  const flaky = steps.map((each) => (each.id === "c" ? { ...each, retries: 1 } : each));
  checked = 0;
  const [retried, again] = await runScript(stageOf(flaky), once);
  expect(retried).toEqual(report(["start", "impl", "c"]));
  expect(again.some(({ prompt }) => prompt.includes("1 failed"))).toBe(false);
});

test("after a gate the next stage starts from its output; a condition picks a branch, and fail_fast ends a stage", async () => {
  const after = stageOf([step("ship", "command", ["g.approved"], { script: "steps/ship/scripts/run.sh" })], {
    fired: ["g.approved"],
    settled: ["g"],
  });
  expect((await runScript(after, () => passing))[0]).toEqual(report(["ship"]));
  const steps = (failFast: boolean): Step[] => [
    step("start", "start"),
    step("c", "condition", ["start.start"], { value: { input: "flag" } }),
    step("x", "command", ["c.true"], { script: "x" }),
    step("y", "command", ["c.false"], { script: "y" }),
    step("a", "command", ["start.start"], { script: "a", failFast }),
    step("p", "agent", ["start.start"], { prompt: "P.", options: { label: "p" } }),
    step("q", "agent", ["p.done"], { prompt: "Q.", options: { label: "q" } }),
  ];
  // a fails beside p; under fail_fast the next wave starts nothing more.
  expect((await runScript(stageOf(steps(true)), failingA, { flag: true }))[0]).toEqual(
    report(["start", "c", "p"], ["a"], ["x", "y", "q"]),
  );
  expect((await runScript(stageOf(steps(false)), failingA, { flag: true }))[0]).toEqual(
    report(["start", "c", "p", "x", "q"], ["a"], ["y"]),
  );
  // A value that is no boolean takes no branch, and an agent the runtime gives up on fails its step.
  const thrown = (call: Call): unknown => {
    if (call.options?.["label"] === "p") throw new Error("agent stalled on all 6 attempts");
    return failingA(call);
  };
  expect((await runScript(stageOf(steps(false)), thrown, { flag: "yes" }))[0]).toEqual(
    report(["start"], ["c", "a", "p"], ["x", "y", "q"]),
  );
});
