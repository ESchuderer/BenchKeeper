import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Plan } from "@cedarloom/contracts";
import { openRunStore, planHash, sha256 } from "@cedarloom/ledger";
import { applyPlan, doctor, listRuns, loadPlan, previewPlan, previewUndo, showRun, undoRun } from "@cedarloom/services";
import { expect, test } from "vitest";

/** A temporary folder: files in it, the run store in `state/` (not created until a change needs it). */
const folder = (): { at: (name: string) => string; state: string } => {
  const root = mkdtempSync(join(tmpdir(), "cedarloom-services-"));
  return { at: (name) => join(root, name), state: join(root, "state") };
};

const creates = (path: string, content = "one\n"): Plan => ({
  schemaVersion: 1,
  operations: [{ kind: "write", path, before: null, content }],
});

const ok = <T>(result: { ok: true; value: T } | { ok: false; finding: { code: string } }): T => {
  if (!result.ok) throw new Error(`expected a value, got ${result.finding.code}`);
  return result.value;
};

test("loadPlan returns the plan of a file, or the finding that says why it is none", () => {
  const { at } = folder();
  expect(loadPlan(at("absent.json"))).toEqual({
    ok: false,
    finding: { code: "document.unreadable", params: { path: at("absent.json"), error: "ENOENT" } },
  });
  writeFileSync(at("cut.json"), '{"schemaVersion":');
  expect(loadPlan(at("cut.json"))).toMatchObject({ ok: false, finding: { code: "document.invalid" } });
  writeFileSync(at("future.json"), JSON.stringify({ schemaVersion: 3 }));
  expect(loadPlan(at("future.json"))).toMatchObject({ ok: false, finding: { code: "document.newer-schema" } });
  const plan = creates(at("a.txt"));
  writeFileSync(at("plan.json"), JSON.stringify(plan));
  expect(loadPlan(at("plan.json"))).toEqual({ ok: true, value: plan });
});

test("previewPlan names each change by hash and size and leaves the contents out", () => {
  const { at } = folder();
  const plan: Plan = {
    schemaVersion: 1,
    operations: [
      { kind: "write", path: at("new.env"), before: null, content: "KEY=hidden-1\n", mode: 0o600 },
      { kind: "write", path: at("old.env"), before: sha256("x"), content: "KEY=hidden-2\n" },
      { kind: "delete", path: at("gone.env"), before: sha256("y") },
    ],
  };
  const preview = previewPlan(plan);
  expect(preview.planHash).toBe(planHash(plan));
  expect(preview.plan.operations).toEqual([
    { kind: "write", path: at("new.env"), before: null, mode: 0o600, after: sha256("KEY=hidden-1\n"), bytes: 13 },
    { kind: "write", path: at("old.env"), before: sha256("x"), after: sha256("KEY=hidden-2\n"), bytes: 13 },
    { kind: "delete", path: at("gone.env"), before: sha256("y") },
  ]);
  expect(JSON.stringify(preview)).not.toContain("hidden");
});

test("reads of a folder without a store find nothing and create nothing", () => {
  const { state } = folder();
  expect(listRuns(state)).toEqual({ ok: true, value: [] });
  for (const result of [showRun(state, "r1"), previewUndo(state, "r1")]) {
    expect(result).toEqual({ ok: false, finding: { code: "run.not-found", params: { runId: "r1" } } });
  }
  expect(doctor(state)).toEqual([]);
  expect(existsSync(state)).toBe(false);
});

test("an approved plan applies as one run, which the reads then show", () => {
  const { at, state } = folder();
  const plan = creates(at("a.txt"));
  expect(ok(applyPlan(state, plan, { approve: sha256("another plan") }))).toMatchObject({
    runId: null,
    status: "refused",
    findings: [{ code: "plan.not-approved" }],
  });
  // No approval at all is refused the same way: the services never apply a plan nobody approved.
  expect(ok(applyPlan(state, plan, {})).findings).toMatchObject([{ params: { approvedHash: "" } }]);
  const run = ok(applyPlan(state, plan, { yes: true }));
  expect(run).toMatchObject({ status: "applied", findings: [] });
  const runs = ok(listRuns(state));
  expect(runs.map((r) => [r.id, r.kind, r.status])).toEqual([[run.runId, "apply", "applied"]]);
  const shown = ok(showRun(state, String(run.runId)));
  expect([shown.run.id, shown.steps.map((s) => [s.state, s.path])]).toEqual([run.runId, [["done", at("a.txt")]]]);
  expect(showRun(state, "r2")).toMatchObject({ ok: false, finding: { code: "run.not-found" } });
  expect(doctor(state)).toEqual([]);
});

test("a run that stops midway names itself; its undo is previewed, applied as a run of its own, then done", () => {
  const { at, state } = folder();
  writeFileSync(at("b.bin"), Buffer.from([0xfe, 0x01]));
  const stopping: Plan = {
    schemaVersion: 1,
    operations: [
      { kind: "write", path: at("a.txt"), before: null, content: "1\n" },
      { kind: "write", path: at("b.bin"), before: sha256(Buffer.from([0xfe, 0x01])), content: "2\n" },
    ],
  };
  const stopped = ok(applyPlan(state, stopping, { yes: true }));
  const runId = String(stopped.runId);
  expect(stopped).toMatchObject({
    status: "failed",
    findings: [{ code: "apply.not-text" }, { code: "run.failed", params: { runId, undoes: null } }],
  });
  expect(doctor(state)).toEqual([{ code: "run.failed", params: { runId, undoes: null } }]);
  const { plan, skipped } = ok(previewUndo(state, runId));
  expect([plan?.operations, skipped]).toEqual([[{ kind: "delete", path: at("a.txt"), before: sha256("1\n") }], []]);
  const undone = ok(undoRun(state, runId, { approve: plan ? planHash(plan) : "" }));
  expect(undone).toMatchObject({ plan, status: "applied", findings: [] });
  expect([existsSync(at("a.txt")), doctor(state)]).toEqual([false, []]);
  expect(ok(undoRun(state, runId, { yes: true }))).toEqual({
    plan: null,
    runId: null,
    status: "nothing-to-undo",
    findings: [],
  });
});

test("a file edited after its run is left as it is and reported by the undo", () => {
  const { at, state } = folder();
  const runId = String(ok(applyPlan(state, creates(at("a.txt")), { yes: true })).runId);
  writeFileSync(at("a.txt"), "mine\n");
  const edited = { code: "undo.file-edited", params: { runId, path: at("a.txt") } };
  expect(ok(previewUndo(state, runId))).toEqual({ plan: null, skipped: [edited] });
  expect(ok(undoRun(state, runId, { yes: true }))).toMatchObject({ status: "nothing-to-undo", findings: [edited] });
  expect(undoRun(state, "r3", { yes: true })).toMatchObject({ ok: false, finding: { code: "run.not-found" } });
});

test("a store another process holds refuses changes; one from a newer CedarLoom refuses reads too", () => {
  const { at, state } = folder();
  const held = openRunStore(state);
  const busy = { ok: false, finding: { code: "store.busy", params: { dir: state } } };
  expect(applyPlan(state, creates(at("a.txt")), { yes: true })).toEqual(busy);
  expect(undoRun(state, "r4", { yes: true })).toEqual(busy);
  if (held.ok) held.value.close();
  const db = new DatabaseSync(join(state, "runs.sqlite"));
  db.exec("PRAGMA user_version = 7");
  db.close();
  const newer = { code: "store.newer-schema", params: { found: 7, known: 1 } };
  for (const result of [listRuns(state), showRun(state, "r4"), previewUndo(state, "r4")]) {
    expect(result).toEqual({ ok: false, finding: newer });
  }
  expect(doctor(state)).toEqual([newer]);
});
