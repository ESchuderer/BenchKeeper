import { type AttemptOutcome, type Json, RunEvent, RunState, WorkflowDefinition } from "@cedarloom/contracts";
import { type Action, replay, resolveInputs, startRun, step } from "@cedarloom/engine";
import * as fc from "fast-check";
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
// A cancel ends the attempt as the script says (it may have failed just before), else cancelled.
const cancelEnd = (action: Action, planned: Planned | undefined, state: RunState): RunEvent | undefined => {
  const node = action.type === "cancel" ? state.nodes[action.node] : undefined;
  if (action.type !== "cancel" || !(node?.state === "running" || node?.state === "cancelling")) return undefined;
  return {
    type: "ended",
    node: action.node,
    attempt: node.attempts,
    outcome: typeof planned === "string" ? planned : "cancelled",
  };
};

// The end of a started attempt the script names: an outcome, or values for a done one (no entry: done).
const ending = (action: Action, planned: Planned | undefined, state: RunState): RunEvent | undefined => {
  if (action.type !== "start" || state.nodes[action.node]?.state !== "running")
    return cancelEnd(action, planned, state);
  const outcome = typeof planned === "string" ? planned : "done";
  return {
    type: "ended",
    node: action.node,
    attempt: action.attempt,
    outcome,
    values: typeof planned === "object" ? planned : {},
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
    // Each event the ledger would store passes its contract.
    events.push(RunEvent.parse(event));
    const next = step(workflow, state, event);
    state = next.state;
    queue.push(...next.actions);
    // Nothing starts before the trigger, and its precheck, are done.
    if (next.actions.some((item) => item.type === "start")) expect(state.nodes["t"]?.state).toBe("done");
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
  // Every driven run: its events, replayed from the start, give the same state (what a resume relies on).
  expect(RunState.parse(state)).toEqual(state);
  expect(replay(workflow, options.inputs ?? {}, events)).toEqual({ ok: true, value: state });
  return { state, actions, events };
};

const states = (state: RunState): string =>
  Object.entries(state.nodes)
    .map(([id, node]) => `${id}:${node.state}`)
    .join(" ");
const starts = (actions: Action[]): string[] =>
  actions.flatMap((action) => (action.type === "start" ? [`${action.node}#${action.attempt}`] : []));
const finished = (actions: Action[]) => actions.find((action) => action.type === "finish");

// The trigger with a precheck.
const checked = (workflow: WorkflowDefinition): WorkflowDefinition => ({
  ...workflow,
  nodes: workflow.nodes.map((node) => (node.id === "t" ? { ...node, with: { precheck: "test -f x" } } : node)),
});

test("a chain runs in order with the outputs its edges name; a value named like a control output fires nothing", () => {
  const workflow = graph(
    ["a:command.run", "b:agent.run", "fix:command.run"],
    ["t.start>a.run", "a.done>b.run", "a.stdout>b.context", "b.result>@out", "a.failed>fix.run"],
    { outputs: { out: { type: "string" } } },
  );
  const result = drive(workflow, { a: [{ stdout: "built", failed: "x" }], b: [{ result: "fine" }] });
  expect([result.state.nodes["fix"]?.state, result.state.nodes["a"]?.values]).toEqual(["skipped", { stdout: "built" }]);
  expect(starts(result.actions)).toEqual(["a#1", "b#1"]);
  expect(result.actions.find((action) => action.type === "start" && action.node === "b")).toMatchObject({
    inputs: { context: "built" },
    timeoutSeconds: 7200,
  });
  expect(finished(result.actions)).toEqual({ type: "finish", status: "succeeded", outputs: { out: "fine" } });
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

test("join any fires at the first branch and cancels what leads only into it; a cancelled branch stays cancelled", () => {
  const workflow = graph(
    ["fast:command.run", "slow:agent.run", "both:command.run", "j:join.any", "end:command.run"],
    ["t.start>fast.run", "t.start>slow.run", "t.start>both.run", "fast.done>j.branches", "slow.done>j.branches"].concat(
      ["both.done>j.branches", "both.stdout>@log", "j.done>end.run"],
    ),
    { outputs: { log: { type: "string" } }, execution: { nodes: { slow: { retries: 2 } } } },
  );
  const started = startRun(workflow, {});
  if (!started.ok) throw new Error("not started");
  const done = (state: RunState, node: string) =>
    step(workflow, state, { type: "ended", node, attempt: 1, outcome: "done" });
  const first = done(started.value.state, "fast");
  expect(first.actions).toEqual([
    { type: "cancel", node: "slow" },
    { type: "start", node: "end", attempt: 1, delayMs: 0, timeoutSeconds: 600, inputs: {} },
  ]);
  expect(states(first.state)).toBe("t:done fast:done slow:cancelling both:running j:done end:running");
  // The cancel is recorded: however the slow attempt ends, it ends cancelled, is never retried and fails nothing.
  for (const outcome of ["interrupted", "failed", "timed-out", "done", "cancelled"] as const) {
    const late = step(workflow, first.state, { type: "ended", node: "slow", attempt: 1, outcome });
    expect([late.actions, late.state.nodes["slow"]?.state]).toEqual([[], "cancelled"]);
    expect(finished([...done(done(late.state, "both").state, "end").actions])?.status).toBe("succeeded");
  }
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
  const withPrecheck = checked(graph(["a:command.run"], ["t.start>a.run"]));
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

test("nothing runs before the trigger and its precheck; a node no control edge reaches is skipped, not started", () => {
  const workflow = checked(
    graph(["c:condition", "cmd:command.run", "lone:command.run"], ["@c>c.value", "c.true>cmd.run"], {
      inputs: { c: { type: "boolean", default: true } },
    }),
  );
  const started = startRun(workflow, {});
  expect(started.ok && started.value.actions).toEqual([{ type: "precheck", node: "t" }]);
  const run = drive(workflow);
  expect([states(run.state), starts(run.actions)]).toEqual(["t:done c:skipped cmd:skipped lone:skipped", []]);
  const none = drive(workflow, { t: ["failed"] });
  expect([states(none.state), finished(none.actions)?.status]).toEqual([
    "t:skipped c:skipped cmd:skipped lone:skipped",
    "skipped",
  ]);
});

test("a cancelled end the run did not ask for counts as a failure; a cancel during the precheck ends the run at once", () => {
  const chain = graph(["a:command.run", "b:command.run"], ["t.start>a.run", "a.done>b.run"]);
  const run = drive(chain, { a: ["cancelled"] });
  expect([states(run.state), finished(run.actions)?.status]).toEqual(["t:done a:failed b:cancelled", "failed"]);
  const workflow = checked(chain);
  const started = startRun(workflow, {});
  if (!started.ok) throw new Error("not started");
  const cancelled = step(workflow, started.value.state, { type: "cancel" });
  expect(cancelled.actions).toEqual([
    { type: "cancel", node: "t" },
    { type: "finish", status: "cancelled", outputs: {} },
  ]);
  expect(step(workflow, cancelled.state, { type: "precheck", passed: false })).toEqual({
    state: cancelled.state,
    actions: [],
  });
});

// Random clean graphs: each node after the trigger takes one or two control edges from earlier nodes.
const KINDS = ["command.run", "agent.run", "condition", "join.any", "join.all", "human.approval"] as const;
const OUT: Record<string, readonly string[]> = {
  "trigger.manual": ["start"],
  "command.run": ["done", "failed"],
  "agent.run": ["done", "failed"],
  condition: ["true", "false"],
  join: ["done"],
  "human.approval": ["approved", "rejected"],
};
const runs = fc.integer({ min: 1, max: 6 }).chain((count) => {
  const each = <T>(arbitrary: fc.Arbitrary<T>) => fc.array(arbitrary, { minLength: count, maxLength: count });
  return fc.record({
    kinds: each(fc.constantFrom(...KINDS)),
    sources: each(fc.uniqueArray(fc.nat(count), { minLength: 1, maxLength: 2 })),
    picks: each(fc.nat()),
    script: each(
      fc.array(fc.constantFrom<Planned>("done", "failed", "timed-out", "interrupted", "cancelled"), { maxLength: 3 }),
    ),
    retries: each(fc.nat({ max: 2 })),
    precheck: fc.boolean(),
    passes: fc.constantFrom<Planned>("done", "failed"),
    cancelAt: fc.option(fc.nat(count - 1), { nil: undefined }),
  });
});

test("random runs: nothing before the trigger, starts within retries, none after a cancel, one finish with nothing open", () => {
  fc.assert(
    fc.property(runs, ({ kinds, sources, picks, script, retries, precheck, passes, cancelAt }) => {
      const ids = kinds.map((_, index) => `n${index}`);
      const nodes = kinds.map((kind, index) => `${ids[index]}:${kind}`);
      const edges = kinds.flatMap((kind, index) => {
        const into = kind.startsWith("join") ? "branches" : "run";
        const from = [...new Set(sources[index]?.map((source) => source % (index + 1)))].map((source) => {
          const type = source === 0 ? "trigger.manual" : (kinds[source - 1] ?? "").replace(/^join\..*/, "join");
          const handles = OUT[type] ?? [];
          return `${source === 0 ? "t" : ids[source - 1]}.${handles[(picks[index] ?? 0) % handles.length]}>${ids[index]}.${into}`;
        });
        return kind === "condition" ? [...from, `@flag>${ids[index]}.value`] : from;
      });
      const execution = { nodes: Object.fromEntries(ids.map((id, index) => [id, { retries: retries[index] ?? 0 }])) };
      const base = graph(nodes, [...new Set(edges)], {
        inputs: { flag: { type: "boolean", default: true } },
        execution,
      });
      const workflow = precheck ? checked(base) : base;
      if (!startRun(workflow, {}).ok) return;
      const plan: Script = {
        t: [passes],
        ...Object.fromEntries(ids.map((id, index) => [id, [...(script[index] ?? [])]])),
      };
      const run = drive(workflow, plan, cancelAt === undefined ? {} : { cancelAt: ids[cancelAt] ?? "" });
      expect(run.actions.filter((action) => action.type === "finish")).toHaveLength(1);
      expect(
        Object.values(run.state.nodes).filter((node) => ["pending", "running", "waiting"].includes(node.state)),
      ).toEqual([]);
      ids.forEach((id, index) => {
        const mine = run.actions.filter((action) => "node" in action && action.node === id);
        expect(mine.filter((action) => action.type === "start").length).toBeLessThanOrEqual((retries[index] ?? 0) + 1);
        const cancelled = mine.findIndex((action) => action.type === "cancel");
        expect(cancelled >= 0 && mine.slice(cancelled).some((action) => action.type === "start")).toBe(false);
      });
      // In a run that succeeded, a node is cancelled only because a join any no longer needed it.
      if (finished(run.actions)?.status !== "succeeded") return;
      const next = (id: string): string[] =>
        workflow.edges.flatMap((edge) =>
          "node" in edge.from && edge.from.node === id && "node" in edge.to ? [edge.to.node] : [],
        );
      const anyJoin = (id: string): boolean =>
        next(id).some((to) => kinds[Number(to.slice(1))] === "join.any" || anyJoin(to));
      const stray = Object.entries(run.state.nodes).filter(([id, node]) => node.state === "cancelled" && !anyJoin(id));
      expect(stray).toEqual([]);
    }),
    { numRuns: 400 },
  );
});
