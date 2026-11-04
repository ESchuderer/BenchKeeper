// BenchKeeper's documented apply and undo behavior (docs/security.md, "Recovery and concurrency" and "Secrets"), one test
// per row that applies to file plans, plus the undo, write and mode cases of BenchKeeper issue 1031.
import { chmodSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { apply, hashFile } from "@cedarloom/engine";
import { planHash } from "@cedarloom/ledger";
import { afterEach, expect, test } from "vitest";
import { hash, modeOf, plan, read, run, storeAt, undo, workspace } from "./helpers.ts";

const posix = process.platform !== "win32";
const stores: { close: () => void }[] = [];
const fresh = (): ReturnType<typeof workspace> & { store: ReturnType<typeof storeAt> } => {
  const space = workspace();
  const store = storeAt(space.state);
  stores.push(store);
  return { ...space, store };
};
/** Two files `a.md` and `b.md` and a plan that rewrites both. */
const twoEdits = (
  file: ReturnType<typeof workspace>["file"],
): { a: string; b: string; edits: ReturnType<typeof plan> } => {
  const [a, b] = [file("a.md", "a\n"), file("b.md", "b\n")];
  const edits = plan(
    { kind: "write", path: a, before: hash("a\n"), content: "A\n" },
    { kind: "write", path: b, before: hash("b\n"), content: "B\n" },
  );
  return { a, b, edits };
};
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

test("every change is backed up and hash-verified before it is written; undo restores byte for byte", () => {
  const { store, file } = fresh();
  const [kept, made, gone] = [file("kept.json", '{ "a": 1 }\n'), file("made.md"), file("gone.md", "old\n")];
  const applied = run(
    store,
    plan(
      { kind: "write", path: kept, before: hash('{ "a": 1 }\n'), content: '{ "a": 2 }\n' },
      { kind: "write", path: made, before: null, content: "new\n" },
      { kind: "delete", path: gone, before: hash("old\n") },
    ),
  );
  expect(applied).toMatchObject({ status: "applied", findings: [] });
  expect([read(kept), read(made), existsSync(gone)]).toEqual(['{ "a": 2 }\n', "new\n", false]);
  expect(read(store.backupPath(applied.runId ?? "", 0))).toBe('{ "a": 1 }\n');
  expect(undo(store, applied.runId)).toMatchObject({ status: "applied", skipped: [] });
  expect([read(kept), existsSync(made), read(gone)]).toEqual(['{ "a": 1 }\n', false, "old\n"]);
});

test.skipIf(!posix)("a failed backup stops the step before any write", () => {
  const { store, file } = fresh();
  const path = file("a.md", "mine\n");
  chmodSync(join(store.dir, "backups"), 0o500);
  const applied = run(store, plan({ kind: "write", path, before: hash("mine\n"), content: "ours\n" }));
  chmodSync(join(store.dir, "backups"), 0o700);
  expect(applied).toMatchObject({
    status: "failed",
    findings: [{ code: "apply.backup-failed", params: { error: "EACCES" } }],
  });
  expect(read(path)).toBe("mine\n");
});

test("the file written must hash as planned", () => {
  const { store, file } = fresh();
  const path = file("a.md", "mine\n");
  const race = (_: number, phase: string): void => {
    if (phase === "written") writeFileSync(path, "theirs\n");
  };
  const applied = run(store, plan({ kind: "write", path, before: hash("mine\n"), content: "ours\n" }), {
    onPhase: race,
  });
  expect(applied).toMatchObject({
    status: "failed",
    findings: [{ code: "apply.write-mismatch", params: { expected: hash("ours\n"), actual: hash("theirs\n") } }],
  });
  expect(store.runs()[0]).toMatchObject({ id: applied.runId, status: "failed" });
});

test("a file changed between the preview and the apply is not overwritten, and no run is recorded", () => {
  const { store, file } = fresh();
  const path = file("a.md", "changed by hand\n");
  expect(run(store, plan({ kind: "write", path, before: hash("previewed\n"), content: "ours\n" }))).toMatchObject({
    runId: null,
    status: "refused",
    findings: [
      { code: "plan.file-changed", params: { expected: hash("previewed\n"), actual: hash("changed by hand\n") } },
    ],
  });
  expect(read(path)).toBe("changed by hand\n");
  expect(store.runs()).toEqual([]);
});

test.each(["edited", "deleted"])("a file %s during the run is not overwritten: the run stops there", (change) => {
  const { store, file } = fresh();
  const { a, b, edits } = twoEdits(file);
  const race = (index: number, phase: string): void => {
    if (index !== 0 || phase !== "settled") return;
    if (change === "edited") writeFileSync(b, "edited\n");
    else rmSync(b);
  };
  const applied = run(store, edits, { onPhase: race });
  expect(applied).toMatchObject({ status: "failed", findings: [{ code: "plan.file-changed" }] });
  expect([read(a), existsSync(b) ? read(b) : null]).toEqual(["A\n", change === "edited" ? "edited\n" : null]);
});

test("a folder where a plan expects a file is an error, never a write", () => {
  const { store, root } = fresh();
  expect(() => run(store, plan({ kind: "write", path: root, before: null, content: "x" }))).toThrow(/EISDIR|EPERM/);
});

test("edits of one file still chain, and undo walks them back", () => {
  const { store, file } = fresh();
  const path = file("notes.md");
  const applied = run(
    store,
    plan(
      { kind: "write", path, before: null, content: "one\n" },
      { kind: "write", path, before: hash("one\n"), content: "one\ntwo\n" },
    ),
  );
  expect([applied.status, read(path)]).toEqual(["applied", "one\ntwo\n"]);
  expect(undo(store, applied.runId).status).toBe("applied");
  expect(existsSync(path)).toBe(false);
});

test("undo is a run of its own that records each file before it moves anything, and can itself be undone", () => {
  const { store, file } = fresh();
  const path = file("a.md", "mine\n");
  const applied = run(store, plan({ kind: "write", path, before: hash("mine\n"), content: "ours\n" }));
  const undone = undo(store, applied.runId);
  expect(store.run(undone.runId ?? "")).toMatchObject({
    run: { kind: "undo", undoes: applied.runId, status: "applied" },
    steps: [{ path, before: hash("ours\n"), after: hash("mine\n"), state: "done", backedUp: true }],
  });
  expect(undo(store, undone.runId).status).toBe("applied");
  expect(read(path)).toBe("ours\n");
});

test("undo refuses a missing or changed backup", () => {
  const { store, file } = fresh();
  const path = file("a.md", "mine\n");
  const applied = run(store, plan({ kind: "write", path, before: hash("mine\n"), content: "ours\n" }));
  const backup = store.backupPath(applied.runId ?? "", 0);
  writeFileSync(backup, "tampered\n");
  expect(undo(store, applied.runId)).toMatchObject({ status: "refused", findings: [{ code: "undo.backup-changed" }] });
  rmSync(backup);
  expect(undo(store, applied.runId)).toMatchObject({ status: "refused", findings: [{ code: "undo.backup-missing" }] });
  expect(read(path)).toBe("ours\n");
  expect(undo(store, "no-such-run")).toMatchObject({ status: "refused", findings: [{ code: "run.not-found" }] });
});

test("undo restores only text backups, and a run with nothing left to undo plans nothing", () => {
  const { store, file } = fresh();
  const path = file("a.bin");
  writeFileSync(path, Buffer.from([0xff, 0xfe, 0x00]));
  const applied = run(store, plan({ kind: "write", path, before: hashFile(path), content: "text\n" }));
  expect(undo(store, applied.runId)).toMatchObject({ status: "refused", findings: [{ code: "undo.not-text" }] });
  const other = file("b.md", "b\n");
  const done = run(store, plan({ kind: "write", path: other, before: hash("b\n"), content: "B\n" }));
  writeFileSync(other, "b\n");
  expect(undo(store, done.runId)).toEqual({ runId: null, status: "applied", findings: [], skipped: [] });
});

test("undo skips and reports a file the owner edited after the run, and restores the others", () => {
  const { store, file } = fresh();
  const { a, b, edits } = twoEdits(file);
  const applied = run(store, edits);
  writeFileSync(b, "B and my own line\n");
  expect(undo(store, applied.runId)).toMatchObject({ status: "applied", skipped: ["undo.file-edited"] });
  expect([read(a), read(b)]).toEqual(["a\n", "B and my own line\n"]);
});

test("issue 1031: undo keeps the owner's later edit of a file whose step failed after writing", () => {
  const { store, file } = fresh();
  const path = file("settings.json", "mine\n");
  const race = (_: number, phase: string): void => {
    if (phase === "written") writeFileSync(path, "ours, then the agent's own rewrite\n");
  };
  const applied = run(store, plan({ kind: "write", path, before: hash("mine\n"), content: "ours\n" }), {
    onPhase: race,
  });
  writeFileSync(path, "days of later work\n");
  expect(undo(store, applied.runId)).toMatchObject({ skipped: ["undo.file-edited"] });
  expect(read(path)).toBe("days of later work\n");
});

test.skipIf(!posix)("issue 1031: a write that fails leaves the old file in place", () => {
  const { store, root, file } = fresh();
  const path = file("a.md", "mine\n");
  chmodSync(root, 0o500);
  const applied = run(store, plan({ kind: "write", path, before: hash("mine\n"), content: "ours\n" }));
  chmodSync(root, 0o700);
  expect(applied).toMatchObject({
    status: "failed",
    findings: [{ code: "apply.write-failed", params: { error: "EACCES" } }],
  });
  expect(read(path)).toBe("mine\n");
  expect(undo(store, applied.runId)).toMatchObject({ status: "applied", skipped: [] });
});

test.skipIf(!posix)("issue 1031: file modes survive apply and undo; a created file gets the planned mode", () => {
  const { store, file } = fresh();
  const [secret, key, made] = [file(".env.local", "TOKEN=1\n", 0o600), file("key", "k\n", 0o600), file("new")];
  const applied = run(
    store,
    plan(
      { kind: "write", path: secret, before: hash("TOKEN=1\n"), content: "TOKEN=2\n" },
      { kind: "delete", path: key, before: hash("k\n") },
      { kind: "write", path: made, before: null, content: "n\n", mode: 0o600 },
    ),
  );
  expect([modeOf(secret), modeOf(made), modeOf(store.backupPath(applied.runId ?? "", 0))]).toEqual([
    0o600, 0o600, 0o600,
  ]);
  undo(store, applied.runId);
  expect([read(secret), modeOf(secret), read(key), modeOf(key)]).toEqual(["TOKEN=1\n", 0o600, "k\n", 0o600]);
});

test("backups of runs older than 90 days go before the next apply; undo of such a run reports the missing backup", () => {
  const { store, state, file } = fresh();
  const path = file("a.md", "mine\n");
  const old = run(store, plan({ kind: "write", path, before: hash("mine\n"), content: "ours\n" }));
  const db = new DatabaseSync(join(state, "runs.sqlite"));
  db.prepare("UPDATE runs SET startedAt = '2000-01-01T00:00:00.000Z'").run();
  db.close();
  run(store, plan({ kind: "write", path: file("b.md"), before: null, content: "b\n" }));
  expect(undo(store, old.runId)).toMatchObject({ status: "refused", findings: [{ code: "undo.backup-missing" }] });
});

test("an approval of another plan is refused before anything is written", () => {
  const { store, file } = fresh();
  const path = file("a.md");
  const value = plan({ kind: "write", path, before: null, content: "a\n" });
  expect(apply(store, value, hash("another plan"))).toMatchObject({
    status: "refused",
    findings: [{ code: "plan.not-approved", params: { planHash: planHash(value) } }],
  });
  expect(existsSync(path)).toBe(false);
});
