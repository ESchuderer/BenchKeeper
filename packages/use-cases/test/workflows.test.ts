import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type Json, WorkflowDefinition } from "@cedarloom/contracts";
import { OUTPUT_CAP } from "@cedarloom/engine";
import { openGraphStore } from "@cedarloom/ledger";
import { cancelRun, listGraphRuns, type RunOptions, resumeRun, runWorkflow, showGraphRun } from "@cedarloom/use-cases";
import { expect, test } from "vitest";

type Node = WorkflowDefinition["nodes"][number];
const now = () => Promise.resolve();

// "a.done" is handle done of node a; "@x" is the workflow input (at an edge's start) or output (at its end) x.
const point = (text: string, field: "input" | "output") => {
  const dot = text.indexOf(".");
  return dot < 0 ? { [field]: text.slice(1) } : { node: text.slice(0, dot), handle: text.slice(dot + 1) };
};
const edge = (spec: string, index: number) => {
  const [start = "", stop = ""] = spec.split(">");
  return { id: `e${index}`, from: point(start, "input"), to: point(stop, "output") };
};
const refused = (code: string, params: object = {}) => ({ ok: false, finding: { code, params } });
const codeOf = (result: { ok: boolean; finding?: { code: string } }) => result.finding?.code ?? "ok";

/** A project folder with the workflow of these nodes and edges ("from>to", separated by spaces) in it. */
const project = (nodes: Node[], edges: string, more: Partial<WorkflowDefinition> = {}) => {
  const root = mkdtempSync(join(tmpdir(), "cedarloom-workflows-"));
  const workflow = {
    schemaVersion: 1,
    kind: "cedarloom.workflow",
    metadata: { id: "w", name: "W", version: "1.0.0" },
    nodes: [{ id: "t", type: "trigger.manual" }, ...nodes],
    edges: edges.split(" ").map(edge),
    ...more,
  };
  writeFileSync(join(root, "w.json"), JSON.stringify(workflow));
  const options: RunOptions = { project: root, sleep: now };
  return { root, state: join(root, "state"), file: join(root, "w.json"), options };
};
const command = (id: string, line: string): Node => ({ id, type: "command.run", with: { command: line } });

// The fixture's runner of the project's workflow, killed after its event `at` (0: never), and the id of its run once
// an attempt has started or the runner has died.
const runner = async ({ root, state, file }: ReturnType<typeof project>, at: number) => {
  const fixture = join(import.meta.dirname, "fixtures", "run.ts");
  const child = spawn(process.execPath, [fixture, state, root, file, String(at)], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const exited = once(child, "exit");
  await Promise.race([once(child.stdout, "data"), exited]);
  const db = new DatabaseSync(join(state, "runs.sqlite"), { readOnly: true });
  const runId = String(db.prepare("SELECT id FROM graph_runs ORDER BY startedAt DESC LIMIT 1").get()?.["id"]);
  db.close();
  return { runId, exited };
};
const statusOf = async (state: string, runId: string) => {
  const shown = await showGraphRun(state, runId);
  return shown.ok ? shown.value.run.status : shown.finding.code;
};

const eventsOf = (state: string, runId: string) => {
  const store = openGraphStore(state);
  if (!store.ok) throw new Error(store.finding.code);
  const events = store.value.events(runId);
  store.value.close();
  return events.ok ? events.value : [];
};
// The values of the node's attempt that did not fail.
const valuesOf = (state: string, runId: string, node: string): Record<string, Json> | undefined =>
  eventsOf(state, runId).flatMap((event) =>
    event.type === "ended" && event.node === node && event.outcome !== "failed" ? [event.values] : [],
  )[0];

test("a command graph runs end to end: inputs only as variables, a file read, a condition, outputs within the cap", async () => {
  const nodes = [
    command("greet", `printf 'hello %s' "$CEDARLOOM_INPUT_name"`),
    { id: "notes", type: "file.read", with: { path: "notes.txt" } },
    { id: "loud", type: "condition" },
    command("shout", "printf LOUD"),
    command("big", `yes | head -c ${OUTPUT_CAP * 2}`),
  ];
  const edges = "t.start>greet.run t.start>notes.run t.start>loud.run @loud>loud.value loud.true>shout.run";
  const inputs = { name: { type: "string" }, loud: { type: "boolean", default: false } } as const;
  const outputs = { greeting: { type: "string" }, notes: { type: "string" } } as const;
  const at = project(nodes, `${edges} t.start>big.run greet.stdout>@greeting notes.content>@notes`, {
    inputs,
    outputs,
  });
  writeFileSync(join(at.root, "notes.txt"), "remember\n");
  const name = "$(touch pwned); `touch pwned`";
  const run = await runWorkflow(at.state, at.file, { name }, at.options);
  const runId = run.ok ? run.value.runId : "";
  const outcome = { status: "succeeded", outputs: { greeting: `hello ${name}`, notes: "remember\n" } };
  expect(eventsOf(at.state, runId).at(-1)).toEqual({ type: "finished", ...outcome });
  expect(existsSync(join(at.root, "pwned"))).toBe(false);
  expect(valuesOf(at.state, runId, "shout")).toBeUndefined();
  const big = valuesOf(at.state, runId, "big");
  expect(big).toMatchObject({ truncated: ["stdout"], exitCode: 0 });
  expect(big?.["stdout"]).toHaveLength(OUTPUT_CAP);
});

// 1 to 4 kill the runner after each event of t -> a -> b; the resume finishes the run, and each command ran once.
// A kill between the gate's line and `ended` would rerun a command that may still run: Q4, and the orphan follow-up.
test.each([1, 2, 3, 4])(
  "killed after event %i, the run resumes to its end and runs no command twice",
  async (at) => {
    const nodes = [command("a", "echo a >> a.log"), command("b", "echo b >> b.log")];
    const retried = { execution: { nodes: { a: { retries: 1 }, b: { retries: 1 } } } };
    const where = project(nodes, "t.start>a.run a.done>b.run", retried);
    const { root, state, options } = where;
    const { runId, exited } = await runner(where, at);
    await exited;
    // Without a folder, the resume runs in the one the run recorded.
    const recorded = { ...options, project: undefined };
    expect(await resumeRun(state, runId, recorded)).toEqual({ ok: true, value: { runId, status: "succeeded" } });
    expect(readFileSync(join(root, "a.log"), "utf8") + readFileSync(join(root, "b.log"), "utf8")).toBe("a\nb\n");
    // A run that has ended is not taken over again.
    expect(await resumeRun(state, runId, options)).toMatchObject({ ok: false, finding: { code: "run.finished" } });
  },
  30_000,
);

test("a failing command, a missing file, a missing shell and a timeout end their attempts; the run says why", async () => {
  const failing = project([command("a", "exit 3")], "t.start>a.run");
  const run = await runWorkflow(failing.state, failing.file, {}, failing.options);
  expect(run).toMatchObject({ ok: true, value: { status: "failed" } });
  const runId = run.ok ? run.value.runId : "";
  expect(eventsOf(failing.state, runId)[1]).toMatchObject({ outcome: "failed", values: { exitCode: 3 } });
  const missing = project([{ id: "r", type: "file.read", with: { path: "nope.txt" } }], "t.start>r.run");
  expect(await runWorkflow(missing.state, missing.file, {}, missing.options)).toMatchObject({
    value: { status: "failed" },
  });
  const gone = { ...failing.options, shell: join(failing.root, "no-sh") };
  expect(await runWorkflow(failing.state, failing.file, {}, gone)).toMatchObject({ value: { status: "failed" } });
  // The timeout ends the command's whole process group: the sleep holds its output open until it is stopped.
  const second = { execution: { nodes: { a: { timeoutSeconds: 1 } } } };
  const slow = project([command("a", "sleep 30")], "t.start>a.run", second);
  const started = Date.now();
  expect(await runWorkflow(slow.state, slow.file, {}, slow.options)).toMatchObject({ value: { status: "failed" } });
  expect(Date.now() - started).toBeLessThan(10_000);
  // A shell that exits at once leaves a background child with the output: the timeout stops it too. Windows has no
  // process group to stop, so there it outlives the attempt, which still ends.
  const late = project([command("a", "(sleep 2; echo late > late.txt) &")], "t.start>a.run", second);
  expect(await runWorkflow(late.state, late.file, {}, late.options)).toMatchObject({ value: { status: "failed" } });
  await new Promise((resolve) => setTimeout(resolve, 3000));
  expect(existsSync(join(late.root, "late.txt")) && process.platform !== "win32").toBe(false);
  // An input the OS refuses in an environment (a NUL byte) fails the attempt; the runner goes on.
  const named = project([command("a", "true")], "t.start>a.run", { inputs: { name: { type: "string" } } });
  const nul = await runWorkflow(named.state, named.file, { name: "a\u0000b" }, named.options);
  expect(nul).toMatchObject({ value: { status: "failed" } });
}, 30_000);

test("a run is refused before it starts: no shell, a node type that does not run yet, a file that is no workflow", async () => {
  const at = project([command("a", "true")], "t.start>a.run");
  expect(await runWorkflow(at.state, at.file, {}, { ...at.options, shell: null })).toEqual(
    refused("run.shell-missing"),
  );
  const agent = project([{ id: "ask", type: "agent.run", with: { task: "Look." } }], "t.start>ask.run");
  expect(await runWorkflow(agent.state, agent.file, {}, agent.options)).toEqual(
    refused("run.node-unsupported", { node: "ask", type: "agent.run" }),
  );
  expect(codeOf(await runWorkflow(at.state, join(at.root, "none.json"), {}, at.options))).toBe("document.unreadable");
  expect(await resumeRun(at.state, "nope", at.options)).toEqual(refused("run.not-found", { runId: "nope" }));
  // No shell is needed without commands; a store a newer version wrote is refused.
  const read = project([{ id: "r", type: "file.read", with: { path: "w.json" } }], "t.start>r.run");
  expect(codeOf(await runWorkflow(read.state, read.file, {}, { ...read.options, shell: null }))).toBe("ok");
  const db = new DatabaseSync(join(read.state, "runs.sqlite"));
  db.exec("PRAGMA user_version = 99");
  db.close();
  expect(codeOf(await runWorkflow(read.state, read.file, {}, read.options))).toBe("store.newer-schema");
});

test("a resume says why a stored run no longer starts, and refuses a journal it cannot trust", async () => {
  const at = project([command("a", "true")], "t.start>a.run");
  const created = openGraphStore(at.state);
  if (!created.ok) throw new Error(created.finding.code);
  const definition = WorkflowDefinition.parse(JSON.parse(readFileSync(at.file, "utf8")));
  const run = { inputs: {}, trigger: "manual", mode: "act", parentRun: null, parentNode: null, project: null } as const;
  const [changed, corrupt] = [1, 2].map(() => created.value.create({ ...run, definition }));
  for (const lease of [changed, corrupt]) lease?.release();
  created.value.close();
  const db = new DatabaseSync(join(at.state, "runs.sqlite"));
  // The validator of this version refuses an edge to a node that is gone.
  const dangling = { ...definition, edges: [...definition.edges, edge("a.done>gone.run", 9)] };
  const [changedId = "", corruptId = ""] = [changed?.runId, corrupt?.runId];
  db.prepare("UPDATE graph_runs SET definition = ? WHERE id = ?").run(JSON.stringify(dangling), changedId);
  db.prepare("INSERT INTO run_events VALUES (?, 1, '2026-11-06T12:00:00.000Z', 'cancel', NULL, NULL, '{')").run(
    corruptId,
  );
  db.close();
  expect(codeOf(await resumeRun(at.state, changedId, at.options))).toBe("workflow.dangling-edge");
  // A refused resume lets go of the run: the next one takes it over again, and is refused for the same reason.
  for (const _ of [1, 2]) expect(codeOf(await resumeRun(at.state, corruptId, at.options))).toBe("run.event-invalid");
});

test("a cancel ends a run: its runner stops it, and a run no process runs is taken over and ends cancelled", async () => {
  const at = project([command("a", "sleep 30")], "t.start>a.run");
  const live = await runner(at, 0);
  const asked = { ok: true, value: { runId: live.runId, status: "cancelling" } };
  expect(await cancelRun(at.state, live.runId, at.options)).toEqual(asked);
  await live.exited;
  // On Windows the signal ends the runner itself, and the run is interrupted until the next cancel ends it.
  if ((await statusOf(at.state, live.runId)) !== "cancelled") await cancelRun(at.state, live.runId, at.options);
  expect(await statusOf(at.state, live.runId)).toBe("cancelled");
  // A runner that died after a started: the cancel takes the run over, and a's attempt ends interrupted with its pid.
  const dead = await runner(at, 1);
  await dead.exited;
  expect(await cancelRun(at.state, dead.runId, at.options)).toEqual({
    ok: true,
    value: { runId: dead.runId, status: "cancelled" },
  });
  expect(await showGraphRun(at.state, dead.runId)).toMatchObject({
    value: { attempts: [{ node: "a", attempt: 1, state: "interrupted", pid: expect.any(Number) }] },
  });
  expect(codeOf(await cancelRun(at.state, dead.runId, at.options))).toBe("run.finished");
  // A resume or cancel from another folder is refused: the run's commands run only in its own.
  const elsewhere = { ...at.options, project: join(at.root, "elsewhere") };
  expect(codeOf(await resumeRun(at.state, dead.runId, elsewhere))).toBe("run.project-mismatch");
  expect(codeOf(await cancelRun(at.state, dead.runId, elsewhere))).toBe("run.project-mismatch");
  expect(await cancelRun(at.state, "nope", at.options)).toEqual(refused("run.not-found", { runId: "nope" }));
  expect(await statusOf(at.state, "nope")).toBe("run.not-found");
  const listed = await listGraphRuns(at.state);
  expect(listed.ok && listed.value.map((run) => run.id)).toEqual([dead.runId, live.runId]);
  expect([await listGraphRuns(join(at.root, "none")), await statusOf(join(at.root, "none"), "x")]).toEqual([
    { ok: true, value: [] },
    "run.not-found",
  ]);
}, 30_000);

test("inputs given as text are read for number, boolean and json inputs; text that does not read is refused", async () => {
  const types = { count: "number", loud: "boolean", data: "json", name: "string" } as const;
  const inputs = Object.fromEntries(Object.entries(types).map(([name, type]) => [name, { type }]));
  const at = project([command("a", "true")], "t.start>a.run", { inputs });
  const run = await runWorkflow(
    at.state,
    at.file,
    { count: "3", loud: "true", data: '{"a":1}', name: "3" },
    at.options,
  );
  const shown = await showGraphRun(at.state, run.ok ? run.value.runId : "");
  expect(shown).toMatchObject({ value: { run: { inputs: { count: 3, loud: true, data: { a: 1 }, name: "3" } } } });
  expect(codeOf(await runWorkflow(at.state, at.file, { count: "three" }, at.options))).toBe("run.input-invalid");
});
