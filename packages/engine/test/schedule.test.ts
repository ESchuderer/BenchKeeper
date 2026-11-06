import { type Json, WorkflowDefinition } from "@cedarloom/contracts";
import {
  type Action,
  type AttemptOutcome,
  type RunEvent,
  type RunState,
  replay,
  resolveInputs,
  startRun,
  step,
} from "@cedarloom/engine";
import { expect, test } from "vitest";

type Values = Record<string, Json>;

// Each node's configuration, so the workflows are valid; a node is "id:type".
const settings: Record<string, Values> = {
  "agent.run": { task: "Do it." },
  "command.run": { command: "true" },
  "human.approval": { message: "Go on?" },
  "join.any": { policy: "any" },
  "join.all": { policy: "all" },
};

// "a.done" is handle done of node a; "@x" is the workflow input (at the start) or output (at the end) x.
const end = (text: string, side: "input" | "output") => {
  const [node = "", handle = ""] = text.split(".");
  return text.startsWith("@") ? { [side]: text.slice(1) } : { node, handle };
};

/** "id:type" nodes ("j:join.any" is a join with that policy) and "a.done>b.run" edges ("@x" an input or output). */
const graph = (nodes: string[], edges: string[], more: object = {}): WorkflowDefinition =>
  WorkflowDefinition.parse({
    schemaVersion: 1,
    kind: "cedarloom.workflow",
    metadata: { id: "g", name: "G", version: "1.0.0" },
    nodes: ["t:trigger.manual", ...nodes].map((spec) => {
      const [id = "", type = ""] = spec.split(":");
      const config = Object.hasOwn(settings, type) ? settings[type] : undefined;
      return { id, type: type.startsWith("join.") ? "join" : type, ...(config ? { with: config } : {}) };
    }),
    edges: edges.map((spec, index) => {
      const [from = "", to = ""] = spec.split(">");
      return { id: `e${index}`, from: end(from, "input"), to: end(to, "output") };
    }),
    ...more,
  });

type Planned = AttemptOutcome | Values;
type Script = Record<string, Planned[]>;

// An approval's or precheck's verdict, as the script says; it answers "failed" for no.
const verdict = (action: Action, planned: Planned | undefined): RunEvent | undefined => {
  if (action.type === "precheck") return { type: "precheck", passed: planned !== "failed" };
  return action.type === "wait" ? { type: "decided", node: action.node, approved: planned !== "failed" } : undefined;
};

// A cancel taking effect, or the end of an attempt the script names.
const ending = (action: Action, planned: Planned | undefined, state: RunState): RunEvent | undefined => {
  const node = action.type === "finish" ? undefined : state.nodes[action.node];
  if (node?.state !== "running") return undefined;
  if (action.type === "cancel")
    return { type: "ended", node: action.node, attempt: node.attempts, outcome: "cancelled" };
  if (action.type !== "start") return undefined;
  const values = typeof planned === "object" ? planned : {};
  return {
    type: "ended",
    node: action.node,
    attempt: action.attempt,
    outcome: typeof planned === "string" ? planned : "done",
    values,
  };
};

const answer = (action: Action, script: Script, state: RunState): RunEvent | undefined => {
  const planned = action.type === "finish" ? undefined : script[action.node]?.shift();
  return verdict(action, planned) ?? ending(action, planned, state);
};

/**
 * Plays the executor: each start of a node ends with the next outcome its script names (a values object ends it
 * done with those values; no entry: done), approvals answer `approve`, a precheck answers `precheck`. It returns the
 * final state, the actions in order and the events it fed, so a test can replay them.
 */
const drive = (
  workflow: WorkflowDefinition,
  script: Script = {},
  options: { inputs?: Values; cancelAt?: string } = {},
) => {
  const started = startRun(workflow, options.inputs ?? {});
  if (!started.ok) throw new Error(started.finding.code);
  let state: RunState = started.value.state;
  const queue: Action[] = [...started.value.actions];
  const actions: Action[] = [];
  const events: RunEvent[] = [];
  const feed = (event: RunEvent): void => {
    events.push(event);
    const next = step(workflow, state, event);
    state = next.state;
    queue.push(...next.actions);
  };
  for (let action = queue.shift(); action !== undefined; action = queue.shift()) {
    actions.push(action);
    if (action.type === "start" && action.node === options.cancelAt) {
      feed({ type: "cancel" });
      continue;
    }
    const event = answer(action, script, state);
    if (event !== undefined) feed(event);
  }
  return { state, actions, events };
};

const states = (state: RunState): string =>
  Object.entries(state.nodes)
    .map(([id, node]) => `${id}:${node.state}`)
    .join(" ");
const starts = (actions: Action[]): string[] =>
  actions.flatMap((action) => (action.type === "start" ? [`${action.node}#${action.attempt}`] : []));
const finished = (actions: Action[]) => actions.find((action) => action.type === "finish");

// Every scenario: the events the driver fed, replayed from the start, give the same state (what a resume relies on).
const replays = (workflow: WorkflowDefinition, result: ReturnType<typeof drive>, inputs: Values = {}): void => {
  expect(replay(workflow, inputs, result.events)).toEqual({ ok: true, value: result.state });
};

test("a chain runs in order; the run succeeds with the outputs its edges name", () => {
  const workflow = graph(
    ["a:command.run", "b:agent.run"],
    ["t.start>a.run", "a.done>b.run", "a.stdout>b.context", "b.result>@out"],
    {
      outputs: { out: { type: "string" } },
    },
  );
  const result = drive(workflow, { a: [{ stdout: "built" }], b: [{ result: "fine" }] });
  expect(starts(result.actions)).toEqual(["a#1", "b#1"]);
  expect(result.actions.find((action) => action.type === "start" && action.node === "b")).toMatchObject({
    inputs: { context: "built" },
    timeoutSeconds: 7200,
  });
  expect(finished(result.actions)).toEqual({ type: "finish", status: "succeeded", outputs: { out: "fine" } });
  replays(workflow, result);
});

test("skip propagation: an untaken branch skips its nodes and theirs; a merge without a join is skipped, a join any runs", () => {
  const workflow = graph(
    [
      "c:condition",
      "yes:command.run",
      "after:command.run",
      "no:command.run",
      "both:command.run",
      "j:join.any",
      "end:command.run",
    ],
    ["t.start>c.run", "@go>c.value", "c.true>yes.run", "yes.done>after.run", "c.false>no.run"].concat([
      "yes.done>both.run",
      "no.done>both.run",
      "yes.done>j.branches",
      "no.done>j.branches",
      "j.done>end.run",
    ]),
    { inputs: { go: { type: "boolean", default: false } } },
  );
  const result = drive(workflow);
  expect(states(result.state)).toBe("t:done c:done yes:skipped after:skipped no:done both:skipped j:done end:done");
  expect(finished(result.actions)?.status).toBe("succeeded");
  replays(workflow, result);
});

test("join all waits for every branch and is skipped when one is dead; a condition on a value that is no boolean fails", () => {
  const edges = ["t.start>a.run", "t.start>b.run", "a.done>j.branches", "b.done>j.branches", "j.done>z.run"];
  const all = graph(["a:command.run", "b:command.run", "j:join.all", "z:command.run"], edges);
  expect(states(drive(all).state)).toBe("t:done a:done b:done j:done z:done");
  // A dead branch skips a join with `all`, and the skip spreads.
  const branch = graph(
    ["c:condition", "a:command.run", "b:command.run", "j:join.all", "z:command.run"],
    [
      "t.start>c.run",
      "@go>c.value",
      "c.true>a.run",
      "c.false>b.run",
      "a.done>j.branches",
      "b.done>j.branches",
      "j.done>z.run",
    ],
    { inputs: { go: { type: "boolean", default: true } } },
  );
  expect(states(drive(branch).state)).toBe("t:done c:done a:done b:skipped j:skipped z:skipped");
  const routed = drive(all, { b: ["failed"] }, {});
  expect(states(routed.state)).toBe("t:done a:done b:failed j:cancelled z:cancelled");
  const odd = graph(["c:condition", "x:command.run"], ["t.start>c.run", "@v>c.value", "c.true>x.run"], {
    inputs: { v: { type: "json", default: "yes" } },
  });
  const failed = drive(odd);
  expect([states(failed.state), finished(failed.actions)?.status]).toEqual(["t:done c:failed x:cancelled", "failed"]);
});

test("join any fires at the first branch and cancels the nodes that lead only into it, not one that feeds more", () => {
  const workflow = graph(
    ["fast:command.run", "slow:agent.run", "both:command.run", "j:join.any", "end:command.run"],
    ["t.start>fast.run", "t.start>slow.run", "t.start>both.run", "fast.done>j.branches", "slow.done>j.branches"].concat(
      ["both.done>j.branches", "both.stdout>@log", "j.done>end.run"],
    ),
    { outputs: { log: { type: "string" } } },
  );
  const started = startRun(workflow, {});
  if (!started.ok) throw new Error("not started");
  const [first] = [step(workflow, started.value.state, { type: "ended", node: "fast", attempt: 1, outcome: "done" })];
  expect(first.actions).toEqual([
    { type: "cancel", node: "slow" },
    { type: "start", node: "end", attempt: 1, delayMs: 0, timeoutSeconds: 600, inputs: {} },
  ]);
  expect(states(first.state)).toBe("t:done fast:done slow:running both:running j:done end:running");
});

test("failure policies: fail_fast cancels the rest, continue_independent runs the other branch, a failed edge routes", () => {
  const nodes = ["a:command.run", "next:command.run", "b:command.run", "fix:agent.run"];
  const edges = ["t.start>a.run", "a.done>next.run", "t.start>b.run"];
  // One at a time, so b has not started when a fails.
  const one = { maxConcurrency: 1 };
  const fast = drive(graph(nodes.slice(0, 3), edges, { execution: one }), { a: ["failed"] });
  expect([states(fast.state), finished(fast.actions)?.status]).toEqual([
    "t:done a:failed next:cancelled b:cancelled",
    "failed",
  ]);
  const independent = graph(nodes.slice(0, 3), edges, { execution: { ...one, failurePolicy: "continue_independent" } });
  const going = drive(independent, { a: ["failed"] });
  expect([states(going.state), finished(going.actions)?.status]).toEqual([
    "t:done a:failed next:skipped b:done",
    "failed",
  ]);
  // A node's own policy wins over the run's.
  const byNode = { ...one, nodes: { a: { failurePolicy: "continue_independent" } } };
  expect(states(drive(graph(nodes.slice(0, 3), edges, { execution: byNode }), { a: ["failed"] }).state)).toBe(
    "t:done a:failed next:skipped b:done",
  );
  const routed = graph(nodes, [...edges, "a.failed>fix.run", "a.stdout>fix.context"]);
  const fixed = drive(routed, { a: [{ stdout: "error 1" }] }, {});
  expect(fixed.state.nodes["fix"]?.state).toBe("skipped");
  const route = drive(routed, { a: ["failed"] });
  expect([states(route.state), finished(route.actions)?.status]).toEqual([
    "t:done a:failed next:skipped b:done fix:done",
    "succeeded",
  ]);
  replays(routed, route);
});

test("retries: a failed, timed-out or interrupted attempt runs again after a doubling delay; then the failure counts", () => {
  const workflow = graph(["a:command.run"], ["t.start>a.run"], { execution: { nodes: { a: { retries: 3 } } } });
  const result = drive(workflow, { a: ["failed", "timed-out", "interrupted", "failed"] });
  expect(starts(result.actions)).toEqual(["a#1", "a#2", "a#3", "a#4"]);
  const delays = result.actions.flatMap((action) => (action.type === "start" ? [action.delayMs] : []));
  expect(delays).toEqual([0, 5000, 10_000, 20_000]);
  expect(finished(result.actions)?.status).toBe("failed");
  const late = drive(workflow, { a: ["failed", "done"] });
  expect(finished(late.actions)?.status).toBe("succeeded");
  // An event of an attempt that is no longer the running one changes nothing.
  const started = startRun(workflow, {});
  if (!started.ok) throw new Error("not started");
  const retried = step(workflow, started.value.state, { type: "ended", node: "a", attempt: 1, outcome: "failed" });
  const stale = step(workflow, retried.state, { type: "ended", node: "a", attempt: 1, outcome: "done" });
  expect(stale).toEqual({ state: retried.state, actions: [] });
  replays(workflow, result);
});

test("at most maxConcurrency nodes run at once; the next starts when one ends", () => {
  const workflow = graph(
    ["a:command.run", "b:command.run", "c:command.run"],
    ["t.start>a.run", "t.start>b.run", "t.start>c.run"],
    {
      execution: { maxConcurrency: 2 },
    },
  );
  const started = startRun(workflow, {});
  expect(started.ok && starts([...started.value.actions])).toEqual(["a#1", "b#1"]);
  expect(starts(drive(workflow).actions)).toEqual(["a#1", "b#1", "c#1"]);
});

test("a precheck that finds no work skips the run; approvals wait and take their branch; a cancel stops everything", () => {
  const checked = graph(["a:command.run"], ["t.start>a.run"]);
  const withPrecheck = {
    ...checked,
    nodes: checked.nodes.map((n) => (n.id === "t" ? { ...n, with: { precheck: "test -f x" } } : n)),
  };
  const skipped = drive(withPrecheck, { t: ["failed"] });
  expect([states(skipped.state), finished(skipped.actions)]).toEqual([
    "t:skipped a:skipped",
    { type: "finish", status: "skipped", outputs: {} },
  ]);
  expect(starts(drive(withPrecheck).actions)).toEqual(["a#1"]);
  const asked = graph(
    ["ok:human.approval", "go:command.run", "no:command.run"],
    ["t.start>ok.run", "ok.approved>go.run", "ok.rejected>no.run"],
  );
  expect(states(drive(asked).state)).toBe("t:done ok:done go:done no:skipped");
  expect(states(drive(asked, { ok: ["failed"] }).state)).toBe("t:done ok:done go:skipped no:done");
  const chain = graph(["a:command.run", "b:human.approval"], ["t.start>a.run", "a.done>b.run"]);
  const cancelled = drive(chain, {}, { cancelAt: "a" });
  expect([states(cancelled.state), finished(cancelled.actions)?.status]).toEqual([
    "t:done a:cancelled b:cancelled",
    "cancelled",
  ]);
  // A waiting approval ends at once, and the executor is told to drop its question.
  const waiting = startRun(graph(["b:human.approval"], ["t.start>b.run"]), {});
  if (!waiting.ok) throw new Error("not started");
  expect(step(graph(["b:human.approval"], ["t.start>b.run"]), waiting.value.state, { type: "cancel" }).actions).toEqual(
    [
      { type: "cancel", node: "b" },
      { type: "finish", status: "cancelled", outputs: {} },
    ],
  );
  replays(withPrecheck, skipped);
});

test("inputs: a given value is checked against its type, a missing one takes its default; a required one must be there", () => {
  const workflow = graph(["a:agent.run"], ["t.start>a.run", "@focus>a.context"], {
    inputs: {
      focus: { type: "string", default: "tests" },
      depth: { type: "number" },
      strict: { type: "boolean", required: true, default: false },
      extra: { type: "json" },
    },
  });
  expect(resolveInputs(workflow, {})).toEqual({ ok: true, value: { focus: "tests", strict: false } });
  expect(resolveInputs(workflow, { depth: 2, extra: [1] })).toMatchObject({ value: { depth: 2, extra: [1] } });
  expect(resolveInputs(workflow, { depth: "2" })).toMatchObject({
    finding: { code: "run.input-invalid", params: { input: "depth", type: "number" } },
  });
  expect(resolveInputs(workflow, { depth: Number.NaN })).toMatchObject({ finding: { code: "run.input-invalid" } });
  expect(resolveInputs(workflow, { other: 1 })).toMatchObject({
    finding: { code: "run.input-unknown", params: { input: "other" } },
  });
  const required = graph(["a:agent.run"], ["t.start>a.run"], {
    inputs: { strict: { type: "boolean", required: true } },
  });
  expect(resolveInputs(required, {})).toMatchObject({
    finding: { code: "run.input-missing", params: { input: "strict" } },
  });
  expect(startRun(required, {})).toMatchObject({ ok: false, finding: { code: "run.input-missing" } });
  const result = drive(workflow, {}, { inputs: { focus: "docs" } });
  expect(result.actions.find((action) => action.type === "start")).toMatchObject({ inputs: { context: "docs" } });
  replays(workflow, result, { focus: "docs" });
});

test("a workflow with an error finding does not start, and a finished run takes no more events", () => {
  const cycle = graph(["a:command.run", "b:command.run"], ["t.start>a.run", "a.done>b.run", "b.done>a.run"]);
  expect(startRun(cycle, {})).toMatchObject({ ok: false, finding: { code: "workflow.cycle" } });
  expect(replay(cycle, {}, [])).toMatchObject({ ok: false, finding: { code: "workflow.cycle" } });
  // A precheck answer without a precheck running changes nothing.
  const plain = graph(["a:command.run"], ["t.start>a.run"]);
  const begun = startRun(plain, {});
  if (!begun.ok) throw new Error("not started");
  expect(step(plain, begun.value.state, { type: "precheck", passed: false }).state).toEqual(begun.value.state);
  const done = drive(graph(["a:command.run"], ["t.start>a.run"]));
  expect(step(graph(["a:command.run"], ["t.start>a.run"]), done.state, { type: "cancel" })).toEqual({
    state: done.state,
    actions: [],
  });
});
