import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Plan, PlanPreview } from "@cedarloom/contracts";
import { openRunStore, planHash, sha256 } from "@cedarloom/ledger";
import {
  applyPlan,
  doctor,
  listRuns,
  loadPlan,
  previewPlan,
  previewUndo,
  showRun,
  undoRun,
} from "@cedarloom/use-cases";
import { expect, test } from "vitest";

/** A temporary folder: files in it, the run store in `state/` (not created until a change needs it). */
const folder = (): { at: (name: string) => string; state: string } => {
  const root = mkdtempSync(join(tmpdir(), "cedarloom-use-cases-"));
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
  // `approve` wins over `yes`, and no approval at all approves nothing: the use cases never apply an unapproved plan.
  expect(ok(applyPlan(state, plan, { yes: true, approve: sha256("another plan") }))).toMatchObject({
    runId: null,
    status: "refused",
    findings: [{ code: "plan.not-approved" }],
  });
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

test("an undo restores a replaced file only as approved, and no result carries the old or new contents", () => {
  const { at, state } = folder();
  writeFileSync(at(".env"), "TOKEN=old-secret\n");
  const replace: Plan = {
    schemaVersion: 1,
    operations: [
      { kind: "write", path: at(".env"), before: sha256("TOKEN=old-secret\n"), content: "TOKEN=new-secret\n" },
    ],
  };
  const runId = String(ok(applyPlan(state, replace, { yes: true })).runId);
  const preview = ok(previewUndo(state, runId));
  expect(preview).toMatchObject({ plan: { operations: [{ after: sha256("TOKEN=old-secret\n"), bytes: 17 }] } });
  const refused = ok(undoRun(state, runId, { approve: sha256("another plan") }));
  expect([refused.status, readFileSync(at(".env"), "utf8")]).toEqual(["refused", "TOKEN=new-secret\n"]);
  const shown: PlanPreview[] = [];
  const undone = ok(undoRun(state, runId, { approve: String(preview.planHash) }, (plan) => shown.push(plan)));
  expect([undone.status, shown, readFileSync(at(".env"), "utf8")]).toEqual([
    "applied",
    [{ planHash: preview.planHash, plan: preview.plan }],
    "TOKEN=old-secret\n",
  ]);
  expect(JSON.stringify([preview, refused, shown, undone])).not.toContain("secret");
});

test("a run that stops midway names itself until an undo run has undone it", () => {
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
  const failed = { code: "run.failed", params: { runId, undoes: null } };
  expect(stopped).toMatchObject({ status: "failed", findings: [{ code: "apply.not-text" }, failed] });
  expect(doctor(state)).toEqual([failed]);
  expect(ok(undoRun(state, runId, { yes: true }))).toMatchObject({ status: "applied", findings: [] });
  expect([existsSync(at("a.txt")), doctor(state)]).toEqual([false, []]);
  expect(ok(undoRun(state, runId, { yes: true }))).toEqual({ runId: null, status: "nothing-to-undo", findings: [] });
});

test("an undo leaves a file edited since its run, and stops at a backup that is gone", () => {
  const { at, state } = folder();
  const runId = String(ok(applyPlan(state, creates(at("a.txt")), { yes: true })).runId);
  writeFileSync(at("a.txt"), "mine\n");
  const edited = { code: "undo.file-edited", params: { runId, path: at("a.txt") } };
  expect(ok(previewUndo(state, runId))).toEqual({ planHash: null, plan: null, findings: [edited] });
  expect(ok(undoRun(state, runId, { yes: true }))).toMatchObject({ status: "nothing-to-undo", findings: [edited] });
  expect(undoRun(state, "r3", { yes: true })).toMatchObject({ ok: false, finding: { code: "run.not-found" } });
  const replaced = ok(
    applyPlan(
      state,
      {
        ...creates(at("a.txt"), "ours\n"),
        operations: [{ kind: "write", path: at("a.txt"), before: sha256("mine\n"), content: "ours\n" }],
      },
      { yes: true },
    ),
  );
  rmSync(join(state, "backups", String(replaced.runId), "0"));
  expect(previewUndo(state, String(replaced.runId))).toMatchObject({
    ok: false,
    finding: { code: "undo.backup-missing" },
  });
});

test("reads work while a process holds the store; a run it left running shows as interrupted once it is gone", () => {
  const { at, state } = folder();
  const held = openRunStore(state);
  if (!held.ok) throw new Error(held.finding.code);
  const plan = creates(at("a.txt"));
  const begun = held.value.begin("apply", plan, planHash(plan));
  const runId = begun.ok ? begun.value : "";
  expect([ok(listRuns(state))[0]?.status, ok(showRun(state, runId)).run.status, doctor(state)]).toEqual([
    "running",
    "running",
    [],
  ]);
  held.value.close();
  expect([ok(listRuns(state))[0]?.status, ok(showRun(state, runId)).run.status, doctor(state)]).toEqual([
    "interrupted",
    "interrupted",
    [{ code: "run.interrupted", params: { runId, undoes: null } }],
  ]);
});

// Each refusal waits out the store's 1 s busy timeout first, so the test takes over 2 s by design; a loaded CI runner
// (macOS, 5.5 s once) needs more than Vitest's default 5 s.
test("a store another process holds refuses changes; one from a newer CedarLoom refuses reads too", {
  timeout: 15_000,
}, () => {
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
