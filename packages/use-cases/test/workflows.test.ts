import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type Json, type Plan, WorkflowDefinition } from "@cedarloom/contracts";
import { OUTPUT_CAP } from "@cedarloom/engine";
import { type SandboxPolicy, sandboxRuntime, unavailable } from "@cedarloom/extension-host";
import { openGraphStore, openRunStore, planHash, sha256 } from "@cedarloom/ledger";
import {
  applyPlan,
  cancelRun,
  decideRun,
  listGraphRuns,
  listRuns,
  planGraphRun,
  type RunOptions,
  resumeRun,
  runWorkflow,
  showGraphRun,
  undoRun,
  waitsOf,
} from "@cedarloom/use-cases";
import { expect, test, vi } from "vitest";

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
  return { runId, exited, child };
};
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
// Waits until `done` holds, for up to `ms`.
const until = async (done: () => boolean, ms = 10_000): Promise<void> => {
  for (const end = Date.now() + ms; !done() && Date.now() < end; ) await new Promise((go) => setTimeout(go, 50));
};
const statusOf = async (state: string, runId: string) => {
  const shown = showGraphRun(state, runId);
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
  expect(codeOf(listGraphRuns(read.state))).toBe("store.newer-schema");
});

test("a report run is refused before it starts with a node that may write, or a command or precheck where no OS sandbox runs (A28)", async () => {
  const write = project([{ id: "w", type: "file.write", with: { path: "out.txt" } }], "t.start>w.run");
  expect(await runWorkflow(write.state, write.file, {}, { ...write.options, report: true })).toEqual(
    refused("workflow.report-only-write", { node: "w" }),
  );
  const touch = project([command("a", "touch touched")], "t.start>a.run");
  const none = { ...touch.options, report: true, sandbox: unavailable };
  expect(await runWorkflow(touch.state, touch.file, {}, none)).toMatchObject(
    refused("run.sandbox-unavailable", { node: "a" }),
  );
  expect(existsSync(join(touch.root, "touched"))).toBe(false);
  const read: Node = { id: "r", type: "file.read", with: { path: "w.json" } };
  const prechecked = project([], "t.start>r.run", {
    nodes: [{ id: "t", type: "trigger.manual", with: { precheck: "true" } }, read],
  });
  expect(await runWorkflow(prechecked.state, prechecked.file, {}, { ...none, project: prechecked.root })).toMatchObject(
    refused("run.sandbox-unavailable", { node: "t" }),
  );
  expect(listGraphRuns(touch.state)).toMatchObject({ ok: true, value: [] });
  // A stored report run that no start checked, resumed without the option, runs no command outside the sandbox.
  const created = openGraphStore(touch.state);
  if (!created.ok) throw new Error(created.finding.code);
  const definition = WorkflowDefinition.parse(JSON.parse(readFileSync(touch.file, "utf8")));
  const run = { inputs: {}, trigger: "manual", mode: "report", parentRun: null, parentNode: null } as const;
  const lease = created.value.create({ ...run, definition, project: realpathSync(touch.root) });
  lease.release();
  created.value.close();
  expect(await resumeRun(touch.state, lease.runId, { ...touch.options, sandbox: unavailable })).toMatchObject({
    value: { status: "failed" },
  });
  expect(eventsOf(touch.state, lease.runId).find((event) => event.type === "ended")).toMatchObject({
    node: "a",
    outcome: "failed",
    values: { error: "run.sandbox-unavailable" },
  });
  expect(existsSync(join(touch.root, "touched"))).toBe(false);
});

// Whether a sandboxed sh starts here; a machine where none does (the rootless dev container) skips, CI's runners do not.
const sandboxHere = async (root: string): Promise<string | null> => {
  const nothing = { command: "/bin/sh", args: ["-c", ""], cwd: root, env: {} };
  const policy: SandboxPolicy = { read: [root], write: [], network: "none", probe: ["-c", ""] };
  const inside = await sandboxRuntime()
    .wrap(nothing, policy)
    .catch((error: unknown) => String(error));
  return typeof inside === "object" || process.env["CI"] === "true" ? null : String(inside);
};

test.skipIf(process.platform === "win32")(
  "a report run's commands and precheck run in the OS sandbox: they read the project and write only their own temporary folder",
  async ({ skip }) => {
    const read = command("a", 'cat w.json > /dev/null && printf ok > "$TMPDIR/t" && cat "$TMPDIR/t"');
    const at = project([read, command("b", "touch touched")], "t.start>a.run a.done>b.run");
    const why = await sandboxHere(realpathSync(at.root));
    if (why !== null) skip(why);
    const ran = await runWorkflow(at.state, at.file, {}, { ...at.options, report: true });
    expect(ran).toMatchObject({ value: { status: "failed" } });
    const ended = eventsOf(at.state, idOf(ran)).filter((event) => event.type === "ended");
    expect(ended).toMatchObject([
      { node: "a", outcome: "done", values: { stdout: "ok" } },
      { node: "b", outcome: "failed" },
    ]);
    expect(existsSync(join(at.root, "touched"))).toBe(false);
    // A precheck that tries to write is refused in the sandbox too: it fails, and the run is skipped.
    const checked = project([command("a", "true")], "t.start>a.run", {
      nodes: [{ id: "t", type: "trigger.manual", with: { precheck: "touch prechecked" } }, command("a", "true")],
    });
    const skipped = await runWorkflow(checked.state, checked.file, {}, { ...checked.options, report: true });
    expect([skipped, existsSync(join(checked.root, "prechecked"))]).toMatchObject([
      { value: { status: "skipped" } },
      false,
    ]);
  },
  60_000,
);

test("a resume says why a stored run no longer starts, and refuses a journal it cannot trust", async () => {
  const at = project([command("a", "true")], "t.start>a.run");
  const created = openGraphStore(at.state);
  if (!created.ok) throw new Error(created.finding.code);
  const definition = WorkflowDefinition.parse(JSON.parse(readFileSync(at.file, "utf8")));
  const run = { inputs: {}, trigger: "manual", mode: "act", parentRun: null, parentNode: null } as const;
  const folder = realpathSync(at.root);
  const [changed, corrupt] = [1, 2].map(() => created.value.create({ ...run, definition, project: folder }));
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
  // The plan refuses what --yes would refuse: a resume of a run its runner holds; a cancel of it is planned.
  expect(codeOf(planGraphRun(at.state, live.runId, { verb: "resume" }))).toBe("run.lease-held");
  expect(planGraphRun(at.state, live.runId, { verb: "cancel" })).toMatchObject({
    value: { run: { status: "running" } },
  });
  const asked = { ok: true, value: { runId: live.runId, status: "cancelling" } };
  // A runner that ends between the lease's probe and the signal: the run is taken over after all (here it is still held).
  const kill = vi.spyOn(process, "kill").mockImplementationOnce(() => {
    throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
  });
  expect(codeOf(await cancelRun(at.state, live.runId, at.options))).toBe("run.lease-held");
  kill.mockRestore();
  expect(await cancelRun(at.state, live.runId, at.options)).toEqual(asked);
  await live.exited;
  // On Windows the signal ends the runner itself, and the run is interrupted until the next cancel ends it.
  if ((await statusOf(at.state, live.runId)) !== "cancelled") await cancelRun(at.state, live.runId, at.options);
  expect(await statusOf(at.state, live.runId)).toBe("cancelled");
  expect(codeOf(planGraphRun(at.state, live.runId, { verb: "cancel" }))).toBe("run.finished");
  // A runner that died after a started: the cancel takes the run over, and a's attempt ends interrupted with its pid.
  const dead = await runner(at, 1);
  await dead.exited;
  // A read probes the dead runner's lease without taking it.
  expect(await statusOf(at.state, dead.runId)).toBe("interrupted");
  expect(await cancelRun(at.state, dead.runId, at.options)).toEqual({
    ok: true,
    value: { runId: dead.runId, status: "cancelled" },
  });
  expect(showGraphRun(at.state, dead.runId)).toMatchObject({
    value: { attempts: [{ node: "a", attempt: 1, state: "interrupted", pid: expect.any(Number) }] },
  });
  expect(codeOf(await cancelRun(at.state, dead.runId, at.options))).toBe("run.finished");
  // A resume or cancel from another folder is refused: the run's commands run only in its own.
  const elsewhere = { ...at.options, project: at.state };
  expect(codeOf(await resumeRun(at.state, dead.runId, elsewhere))).toBe("run.project-mismatch");
  expect(codeOf(await cancelRun(at.state, dead.runId, elsewhere))).toBe("run.project-mismatch");
  expect(await cancelRun(at.state, "nope", at.options)).toEqual(refused("run.not-found", { runId: "nope" }));
  expect(await statusOf(at.state, "nope")).toBe("run.not-found");
  const listed = listGraphRuns(at.state);
  expect(listed.ok && listed.value.map((run) => run.id)).toEqual([dead.runId, live.runId]);
  expect([listGraphRuns(join(at.root, "none")), await statusOf(join(at.root, "none"), "x")]).toEqual([
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
  const shown = showGraphRun(at.state, run.ok ? run.value.runId : "");
  expect(shown).toMatchObject({ value: { run: { inputs: { count: 3, loud: true, data: { a: 1 }, name: "3" } } } });
  expect(codeOf(await runWorkflow(at.state, at.file, { count: "three" }, at.options))).toBe("run.input-invalid");
  // 1e400 parses to Infinity, which no JSON value holds: a json input keeps the text, a number input refuses it.
  expect(codeOf(await runWorkflow(at.state, at.file, { count: "1e400" }, at.options))).toBe("run.input-invalid");
  expect(codeOf(await runWorkflow(at.state, at.file, { data: "1e400" }, at.options))).toBe("ok");
});

// On Windows Node's job object ends the shell with its runner, so nothing is left to stop; the shell's own children
// may outlive it (hub issue 103).
test.skipIf(process.platform === "win32")(
  "a resume stops what a runner that died left running, and leaves a later process with that pid alone",
  async () => {
    const at = project([command("a", "echo > running.txt; sleep 30")], "t.start>a.run");
    const left = await runner(at, 0);
    await until(() => existsSync(join(at.root, "running.txt")));
    const shown = showGraphRun(at.state, left.runId);
    const pid = (shown.ok && shown.value.attempts[0]?.pid) || 0;
    left.child.kill("SIGKILL");
    await left.exited;
    expect(alive(pid)).toBe(true);
    expect(await resumeRun(at.state, left.runId, at.options)).toMatchObject({ value: { status: "failed" } });
    await until(() => !alive(pid));
    expect(alive(pid)).toBe(false);
    // A process that started after the attempt's record, or over a minute before it, is no orphan of it, whatever its pid.
    // A group leader of its own, as a command's shell is, so a group kill would reach it.
    const later = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true });
    const store = openGraphStore(at.state);
    if (!store.ok) throw new Error(store.finding.code);
    const definition = WorkflowDefinition.parse(JSON.parse(readFileSync(at.file, "utf8")));
    const base = { inputs: {}, trigger: "manual", mode: "act", parentRun: null, parentNode: null } as const;
    // `ps` tells start times to the second only, so each record is seconds away from the process's start.
    for (const away of [-5000, 120_000]) {
      const lease = store.value.create({ ...base, definition, project: realpathSync(at.root) });
      store.value.append(lease.runId, 1, { type: "started", node: "a", attempt: 1, pid: null });
      lease.release();
      const db = new DatabaseSync(join(at.state, "runs.sqlite"));
      const recorded = new Date(Date.now() + away).toISOString();
      db.prepare("UPDATE node_attempts SET pid = ?, startedAt = ? WHERE runId = ?").run(
        Number(later.pid),
        recorded,
        lease.runId,
      );
      db.close();
      expect(await resumeRun(at.state, lease.runId, at.options)).toMatchObject({ value: { status: "failed" } });
      // A child of this process stays a zombie until Node reaps it: its own end is what tells.
      await until(() => later.signalCode !== null, 1000);
      expect(later.signalCode).toBeNull();
    }
    store.value.close();
    later.kill();
  },
  30_000,
);

test("a project folder that is not there refuses a run and a resume before anything starts; a cancel still ends it", async () => {
  const at = project([command("a", "sleep 30")], "t.start>a.run");
  const work = join(at.root, "work");
  mkdirSync(work);
  const dead = await runner({ ...at, root: work }, 1);
  await dead.exited;
  // The run recorded the folder's real path (on macOS /var is a link to /private/var).
  const real = realpathSync(work);
  renameSync(work, `${work}-moved`);
  const recorded = { sleep: now };
  expect(await resumeRun(at.state, dead.runId, recorded)).toEqual(refused("run.project-missing", { project: real }));
  expect(codeOf(await resumeRun(at.state, dead.runId, { ...recorded, project: `${work}-moved` }))).toBe(
    "run.project-mismatch",
  );
  expect(await statusOf(at.state, dead.runId)).toBe("interrupted");
  // Another folder that is not there either is another folder; a file is no folder.
  const other = { ...recorded, project: join(at.root, "other") };
  expect(codeOf(await cancelRun(at.state, dead.runId, other))).toBe("run.project-mismatch");
  expect(codeOf(planGraphRun(at.state, dead.runId, { verb: "cancel", project: other.project }))).toBe(
    "run.project-mismatch",
  );
  expect(codeOf(await runWorkflow(at.state, at.file, {}, { ...recorded, project: at.file }))).toBe(
    "run.project-missing",
  );
  // The plan of a resume or cancel says why the folder is no good, and which attempt is left running.
  expect(codeOf(planGraphRun(at.state, dead.runId, { verb: "resume" }))).toBe("run.project-missing");
  expect(planGraphRun(at.state, dead.runId, { verb: "cancel" })).toMatchObject({
    value: { project: null, attempts: [{ node: "a", state: "running", pid: expect.any(Number) }] },
  });
  expect(codeOf(planGraphRun(at.state, "nope", { verb: "cancel" }))).toBe("run.not-found");
  expect(await cancelRun(at.state, dead.runId, recorded)).toMatchObject({ value: { status: "cancelled" } });
  expect(codeOf(await runWorkflow(at.state, at.file, {}, { ...recorded, project: work }))).toBe("run.project-missing");
  expect(listGraphRuns(at.state)).toMatchObject({ value: [{ id: dead.runId }] });
}, 30_000);

// say -> out: a write of say's output to out.txt, which holds "old".
const writing = () => {
  const out = { id: "out", type: "file.write", with: { path: "out.txt" } } as const;
  const at = project([command("say", "printf new"), out], "t.start>say.run say.done>out.run say.stdout>out.content");
  writeFileSync(join(at.root, "out.txt"), "old");
  return { ...at, text: () => readFileSync(join(at.root, "out.txt"), "utf8") };
};
const idOf = (run: { ok: boolean; value?: { runId: string } }) => run.value?.runId ?? "";

test("a write waits without a runner for its plan's approval, then goes through one apply run that undo reverts", async () => {
  const at = writing();
  const runId = idOf(await runWorkflow(at.state, at.file, {}, at.options));
  const waits = waitsOf(at.state, runId);
  expect([showGraphRun(at.state, runId), at.text(), waits.ok && waits.value.waits]).toMatchObject([
    { value: { run: { status: "waiting" } } },
    "old",
    [{ node: "out", point: "before-apply", planHash: expect.any(String), content: "new" }],
  ]);
  // Another process decides, as after a restart: nothing of the run waited in memory.
  const decided = await decideRun(at.state, runId, { node: "out", approved: true }, at.options);
  const applying = eventsOf(at.state, runId).find((event) => event.type === "applying");
  const applyRun = applying?.type === "applying" ? applying.applyRun : "";
  expect([decided, at.text(), listRuns(at.state)]).toMatchObject([
    { value: { status: "succeeded" } },
    "new",
    { value: [{ id: applyRun, status: "applied" }] },
  ]);
  expect([undoRun(at.state, applyRun, { yes: true }), at.text()]).toMatchObject([
    { value: { status: "applied" } },
    "old",
  ]);
});

test("an approval's answer picks its branch; a cancel ends a waiting write; a node that waits takes no other decision", async () => {
  const ask = { id: "ask", type: "human.approval", with: { message: "Ship it?" } } as const;
  const asking = project([ask, command("ship", "printf shipped")], "t.start>ask.run ask.approved>ship.run");
  const asked = idOf(await runWorkflow(asking.state, asking.file, {}, asking.options));
  const waits = waitsOf(asking.state, asked);
  expect(waits.ok && waits.value.waits).toEqual([
    { node: "ask", point: "human.approval", planHash: null, content: null },
  ]);
  expect(await decideRun(asking.state, asked, { node: "ask", approved: false }, asking.options)).toMatchObject({
    value: { status: "succeeded" },
  });
  expect(showGraphRun(asking.state, asked)).toMatchObject({ value: { attempts: [] } });
  const at = writing();
  const runId = idOf(await runWorkflow(at.state, at.file, {}, at.options));
  const other = await decideRun(at.state, runId, { node: "say", approved: true }, at.options);
  expect(other).toEqual(refused("run.not-waiting", { runId, node: "say" }));
  const cancelled = await cancelRun(at.state, runId, at.options);
  expect([cancelled, at.text()]).toMatchObject([{ value: { status: "cancelled" } }, "old"]);
});

test.skipIf(process.platform === "win32")(
  "a folder or a file linked to outside the project is no way out",
  async () => {
    const outside = mkdtempSync(join(tmpdir(), "cedarloom-outside-"));
    writeFileSync(join(outside, "secret.txt"), "secret");
    const nodes = [
      { id: "read", type: "file.read", with: { path: "linked/secret.txt" } },
      { id: "out", type: "file.write", with: { path: "linked/new.txt" } },
      { id: "link", type: "file.read", with: { path: "secret.txt" } },
    ] as const;
    const at = project([...nodes], "t.start>read.run t.start>out.run t.start>link.run", {
      execution: { failurePolicy: "continue_independent" },
    });
    symlinkSync(outside, join(at.root, "linked"));
    symlinkSync(join(outside, "secret.txt"), join(at.root, "secret.txt"));
    const runId = idOf(await runWorkflow(at.state, at.file, {}, at.options));
    const ends = eventsOf(at.state, runId).flatMap((event) =>
      event.type === "ended" ? [{ node: event.node, outcome: event.outcome, values: event.values }] : [],
    );
    expect([ends.toSorted((a, b) => a.node.localeCompare(b.node)), existsSync(join(outside, "new.txt"))]).toEqual([
      [
        { node: "link", outcome: "failed", values: {} },
        { node: "out", outcome: "failed", values: { error: "file.outside-project" } },
        { node: "read", outcome: "failed", values: { error: "file.outside-project" } },
      ],
      false,
    ]);
  },
);

test("a write into folders that are not there yet makes them, below the project", async () => {
  const out = { id: "out", type: "file.write", with: { path: "reports/2026/today.md" } } as const;
  const at = project([command("say", "printf new"), out], "t.start>say.run say.done>out.run say.stdout>out.content");
  const runId = idOf(await runWorkflow(at.state, at.file, {}, at.options));
  const decided = await decideRun(at.state, runId, { node: "out", approved: true }, at.options);
  expect([decided, readFileSync(join(at.root, "reports", "2026", "today.md"), "utf8")]).toMatchObject([
    { value: { status: "succeeded" } },
    "new",
  ]);
});

test("a stored report run's write that its start did not check writes nothing and asks for no approval", async () => {
  // Without a command, which a report run runs none of.
  const at = project([{ id: "out", type: "file.write", with: { path: "out.txt" } }], "t.start>out.run");
  writeFileSync(join(at.root, "out.txt"), "old");
  const graphs = openGraphStore(at.state);
  if (!graphs.ok) throw new Error(graphs.finding.code);
  const definition = WorkflowDefinition.parse(JSON.parse(readFileSync(at.file, "utf8")));
  const base = { inputs: {}, trigger: "manual", parentRun: null, parentNode: null } as const;
  const created = graphs.value.create({ ...base, definition, mode: "report", project: realpathSync(at.root) });
  created.release();
  graphs.value.close();
  // The executor refuses before it plans, so no gate waits; the ledger would refuse the apply run's record too.
  expect(await resumeRun(at.state, created.runId, at.options)).toMatchObject({ value: { status: "failed" } });
  expect(eventsOf(at.state, created.runId).find((event) => event.type === "ended")).toMatchObject({
    node: "out",
    outcome: "failed",
    values: { error: "run.report-only-apply" },
  });
  expect(readFileSync(join(at.root, "out.txt"), "utf8")).toBe("old");
});

// A run of the write workflow whose runner died in the write: its journal ends with the record of the apply run
// `applyRun`.
const diedInWrite = (at: ReturnType<typeof writing>, applyRun: string): string => {
  const graphs = openGraphStore(at.state);
  if (!graphs.ok) throw new Error(graphs.finding.code);
  const definition = WorkflowDefinition.parse(JSON.parse(readFileSync(at.file, "utf8")));
  const base = { inputs: {}, trigger: "manual", mode: "act", parentRun: null, parentNode: null } as const;
  const created = graphs.value.create({ ...base, definition, project: realpathSync(at.root) });
  for (const event of [
    { type: "started", node: "say", attempt: 1, pid: null },
    { type: "ended", node: "say", attempt: 1, outcome: "done", values: { stdout: "new" } },
    { type: "started", node: "out", attempt: 1, pid: null },
    { type: "applying", node: "out", attempt: 1, applyRun },
  ] as const) {
    graphs.value.append(created.runId, created.epoch, event);
  }
  created.release();
  graphs.value.close();
  return created.runId;
};
const newOut = (at: ReturnType<typeof writing>): Plan => {
  const path = join(realpathSync(at.root), "out.txt");
  return { schemaVersion: 1, operations: [{ kind: "write", path, before: sha256("old"), content: "new" }] };
};

test("a write whose runner died after its apply run applied ends done on a takeover, and applies nothing again", async () => {
  const at = writing();
  const applied = applyPlan(at.state, newOut(at), { yes: true });
  const applyRun = applied.ok ? (applied.value.runId ?? "") : "";
  const resumed = await resumeRun(at.state, diedInWrite(at, applyRun), at.options);
  expect([resumed, at.text(), listRuns(at.state)]).toMatchObject([
    { value: { status: "succeeded" } },
    "new",
    { value: [{ id: applyRun, status: "applied" }] },
  ]);
});

test("a write whose runner died before its apply run applied ends interrupted on a takeover (Q4)", async () => {
  const at = writing();
  // An apply run that began and never finished: the next open of the store marks it interrupted.
  const store = openRunStore(at.state);
  if (!store.ok) throw new Error(store.finding.code);
  const plan = newOut(at);
  const begun = store.value.begin("apply", plan, planHash(plan));
  store.value.close();
  const runId = diedInWrite(at, begun.ok ? begun.value : "");
  const resumed = await resumeRun(at.state, runId, at.options);
  const ended = eventsOf(at.state, runId).find((event) => event.type === "ended" && event.node === "out");
  expect([resumed, ended, at.text()]).toMatchObject([
    { value: { status: "failed" } },
    { outcome: "interrupted" },
    "old",
  ]);
});
