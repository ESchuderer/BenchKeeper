// BenchKeeper's documented apply and undo behavior (docs/security.md, "Recovery and concurrency" and "Secrets"), one test
// per row that applies to file plans, plus the undo, write and mode cases of BenchKeeper issue 1031.
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Operation } from "@cedarloom/contracts";
import { apply, hashFile, tempPath } from "@cedarloom/engine";
import { planHash } from "@cedarloom/ledger";
import { afterEach, expect, test, vi } from "vitest";
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
/** A step of `kind` on `path`: a new file, a replace of "old\n", or its delete. */
const stepOf = (kind: string, path: string): Operation =>
  kind === "delete"
    ? { kind: "delete", path, before: hash("old\n") }
    : { kind: "write", path, before: kind === "create" ? null : hash("old\n"), content: "ours\n" };

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

test("a finished run keeps no file content in its stored plan, and undo still restores from its backups", () => {
  const { store, file } = fresh();
  const path = file("token.env", "TOKEN=1\n");
  const applied = run(store, plan({ kind: "write", path, before: hash("TOKEN=1\n"), content: "TOKEN=2\n" }));
  expect(store.run(applied.runId ?? "")?.plan.operations).toEqual([
    { kind: "write", path, before: hash("TOKEN=1\n"), content: "" },
  ]);
  // The undo run's own plan held the backup's content until it finished.
  const undone = undo(store, applied.runId);
  expect([undone.status, read(path), store.run(undone.runId ?? "")?.plan.operations]).toMatchObject([
    "applied",
    "TOKEN=1\n",
    [{ kind: "write", path, before: hash("TOKEN=2\n"), content: "" }],
  ]);
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

const refused = () => {
  throw new Error("another runner took the run over");
};

test("a run whose begin hook throws ends failed before any write", () => {
  const { store, file } = fresh();
  const path = file("a.md", "mine\n");
  const op = { kind: "write", path, before: hash("mine\n"), content: "ours\n" } as const;
  expect(() => run(store, plan(op), { onBegun: refused })).toThrow("another runner took the run over");
  expect([store.runs().map((each) => each.status), read(path)]).toEqual([["failed"], "mine\n"]);
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

test("a folder where a plan expects a file is refused with a finding, never a write", () => {
  const { store, root } = fresh();
  expect(run(store, plan({ kind: "write", path: root, before: null, content: "x" }))).toMatchObject({
    status: "refused",
    findings: [{ code: "plan.not-a-file", params: { path: root } }],
  });
  expect(store.runs()).toEqual([]);
});

test("a plan whose chain of edits to one file breaks is refused before any operation is written", () => {
  const { store, file } = fresh();
  const [a, b] = [file("a.md", "a\n"), file("b.md")];
  const broken = plan(
    { kind: "write", path: a, before: hash("a\n"), content: "A\n" },
    { kind: "write", path: b, before: null, content: "b\n" },
    { kind: "write", path: a, before: hash("a\n"), content: "AA\n" },
  );
  expect(run(store, broken)).toEqual({
    runId: null,
    status: "refused",
    findings: [{ code: "plan.chain-broken", params: { path: a, index: 2, expected: hash("A\n"), found: hash("a\n") } }],
  });
  expect([read(a), existsSync(b), store.runs()]).toEqual(["a\n", false, []]);
});

test("a temporary file in the way is a write error, not a change of the target", () => {
  const { store, file } = fresh();
  const path = file("new.md");
  const block = (_: number, phase: string): void => {
    if (phase === "journaled") writeFileSync(tempPath(path, store.runs()[0]?.id ?? "", 0), "stale");
  };
  expect(run(store, plan({ kind: "write", path, before: null, content: "x" }), { onPhase: block })).toMatchObject({
    status: "failed",
    findings: [{ code: "apply.write-failed", params: { error: "EEXIST" } }],
  });
  expect(existsSync(path)).toBe(false);
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
    steps: [{ path, before: hash("ours\n"), after: hash("mine\n"), state: "done" }],
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

test("apply refuses a file that is not UTF-8 text, since undo could not restore it", () => {
  const { store, file } = fresh();
  const path = file("a.bin");
  writeFileSync(path, Buffer.from([0xff, 0xfe, 0x00]));
  const applied = run(store, plan({ kind: "write", path, before: hashFile(path), content: "text\n" }));
  expect(applied).toMatchObject({ status: "failed", findings: [{ code: "apply.not-text" }] });
  expect(readFileSync(path)).toEqual(Buffer.from([0xff, 0xfe, 0x00]));
});

test("a byte order mark survives apply and undo, and a run with nothing left to undo plans nothing", () => {
  const { store, file } = fresh();
  const path = file("bom.cs");
  writeFileSync(path, Buffer.from([0xef, 0xbb, 0xbf, 0x41, 0x0a]));
  const applied = run(store, plan({ kind: "write", path, before: hashFile(path), content: "B\n" }));
  expect(undo(store, applied.runId).status).toBe("applied");
  expect(readFileSync(path)).toEqual(Buffer.from([0xef, 0xbb, 0xbf, 0x41, 0x0a]));
  expect(undo(store, applied.runId)).toEqual({ runId: null, status: "applied", findings: [], skipped: [] });
});

test("a chained edit set back by hand to an in-between version is skipped, not overwritten", () => {
  const { store, file } = fresh();
  const path = file("g.md", "A\n");
  const applied = run(
    store,
    plan(
      { kind: "write", path, before: hash("A\n"), content: "B\n" },
      { kind: "write", path, before: hash("B\n"), content: "C\n" },
    ),
  );
  writeFileSync(path, "B\n");
  expect(undo(store, applied.runId)).toMatchObject({ skipped: ["undo.file-edited"] });
  expect(read(path)).toBe("B\n");
});

test.each(["create", "replace", "delete"])(
  "a file that appears or changes while the step is journaled is not overwritten (%s)",
  (kind) => {
    const { store, file } = fresh();
    const path = kind === "create" ? file("new.md") : file("old.md", "old\n");
    const race = (_: number, phase: string): void => {
      if (phase === "journaled") writeFileSync(path, "the owner's autosave\n");
    };
    const op = stepOf(kind, path);
    const applied = run(store, plan(op), { onPhase: race });
    expect(applied).toMatchObject({ status: "failed", findings: [{ code: "plan.file-changed" }] });
    expect(read(path)).toBe("the owner's autosave\n");
    expect(undo(store, applied.runId)).toMatchObject({ skipped: ["undo.file-edited"] });
    expect(read(path)).toBe("the owner's autosave\n");
  },
);

// Hub issue 141: a plan of real paths, whose folder on the way a link replaces after the plan, writes nothing there.
test.skipIf(!posix)("a folder on the way swapped for a link after the plan is refused at the write", () => {
  const { store, root } = fresh();
  const real = realpathSync(root);
  // The check compares real paths, so a folder beside the one it replaces stands for one outside the project.
  const [sub, outside] = [join(real, "sub"), join(real, "outside")];
  mkdirSync(sub);
  mkdirSync(outside);
  const op = { kind: "write", path: join(sub, "new", "file.md"), before: null, content: "x\n" } as const;
  const swap = (_: number, phase: string) => {
    if (phase !== "journaled") return;
    renameSync(sub, join(real, "moved"));
    symlinkSync(outside, sub);
  };
  const applied = run(store, plan(op), { onPhase: swap, realPaths: true });
  expect([applied, readdirSync(outside)]).toMatchObject([
    { status: "failed", findings: [{ code: "apply.write-failed", params: { error: "ELOOP" } }] },
    [],
  ]);
});

test.skipIf(!posix)("a symlink at the target is refused: replacing it would cut the link", () => {
  const { store, file, root } = fresh();
  const real = file("real.md", "real\n");
  const link = join(root, "link.md");
  symlinkSync(real, link);
  expect(run(store, plan({ kind: "write", path: link, before: hash("real\n"), content: "x\n" }))).toMatchObject({
    status: "refused",
    findings: [{ code: "apply.symlink" }],
  });
});

test("a path that is relative or not normalized is refused", () => {
  const { store, root } = fresh();
  for (const path of ["notes.md", `${root}${sep}.${sep}notes.md`]) {
    expect(run(store, plan({ kind: "write", path, before: null, content: "x" }))).toMatchObject({
      status: "refused",
      findings: [{ code: "plan.path-not-absolute", params: { path } }],
    });
  }
});

/** The step's own leftovers next to its target: temporary and set-aside files. */
const leftovers = (root: string): string[] => readdirSync(root).filter((name) => name.includes(".cedarloom-"));

// The window the set-aside step closes: another process saves the file after the step's last check, before the new
// file goes in. Before, a rename put ours over theirs. Now theirs lands in a new file at the path, which stays.
test.each([
  ["write", "in place"],
  ["write", "by rename"],
  ["delete", "in place"],
  ["delete", "by rename"],
] as const)("a %s step keeps a file another process saves %s after the step checked it", (kind, how) => {
  const { store, root, file } = fresh();
  const path = file("settings.json", "mine\n");
  const race = (_: number, phase: string): void => {
    if (phase !== "set-aside") return;
    if (how === "in place") writeFileSync(path, "theirs\n");
    else {
      writeFileSync(join(root, "settings.json.save"), "theirs\n");
      renameSync(join(root, "settings.json.save"), path);
    }
  };
  const op: Operation =
    kind === "write"
      ? { kind: "write", path, before: hash("mine\n"), content: "ours\n" }
      : { kind: "delete", path, before: hash("mine\n") };
  const applied = run(store, plan(op), { onPhase: race });
  // A write finds the path taken; a delete removes only the file it checked and then finds theirs.
  const code = kind === "write" ? "plan.file-changed" : "apply.write-mismatch";
  expect(applied).toMatchObject({ status: "failed", findings: [{ code }] });
  expect([read(path), leftovers(root)]).toEqual(["theirs\n", []]);
  expect(undo(store, applied.runId)).toMatchObject({ skipped: ["undo.file-edited"] });
  expect(read(path)).toBe("theirs\n");
});

test.each(["write", "delete"])("a file deleted while the %s step is journaled is a change, not an error", (kind) => {
  const { store, root, file } = fresh();
  const path = file("old.md", "old\n");
  const race = (_: number, phase: string): void => {
    if (phase === "journaled") rmSync(path);
  };
  const op: Operation =
    kind === "write"
      ? { kind: "write", path, before: hash("old\n"), content: "ours\n" }
      : { kind: "delete", path, before: hash("old\n") };
  expect(run(store, plan(op), { onPhase: race })).toMatchObject({
    status: "failed",
    findings: [{ code: "plan.file-changed", params: { actual: null } }],
  });
  expect([existsSync(path), leftovers(root)]).toEqual([false, []]);
});

test.skipIf(!posix)("a link put at the path while the step is journaled goes back unread", () => {
  const { store, root, file } = fresh();
  const [path, other] = [file("a.md", "a\n"), file("other.md", "other\n")];
  const race = (_: number, phase: string): void => {
    if (phase !== "journaled") return;
    rmSync(path);
    symlinkSync(other, path);
  };
  const applied = run(store, plan({ kind: "write", path, before: hash("a\n"), content: "A\n" }), { onPhase: race });
  expect(applied).toMatchObject({ status: "failed", findings: [{ code: "plan.file-changed" }] });
  expect([read(path), read(other), leftovers(root)]).toEqual(["other\n", "other\n", []]);
});

// The one change the step cannot see: a process that opened the file before the check and writes through that handle
// after it writes into the file set aside, which the step then removes.
test("a write through a handle opened before the check and made after it is the window left", () => {
  const { store, root, file } = fresh();
  const path = file("a.md", "a\n");
  let fd: number | undefined;
  const race = (_: number, phase: string): void => {
    if (phase === "journaled") fd = openSync(path, "r+");
    if (phase === "set-aside" && fd !== undefined) writeSync(fd, "x", 0);
  };
  const applied = run(store, plan({ kind: "write", path, before: hash("a\n"), content: "A\n" }), { onPhase: race });
  if (fd !== undefined) closeSync(fd);
  expect([applied.status, read(path), leftovers(root)]).toEqual(["applied", "A\n", []]);
});

test("an unexpected error during a step marks the run failed before it reaches the caller", () => {
  const { store, file } = fresh();
  const [a, b] = [file("a.md", "a\n"), file("b.md")];
  const value = plan(
    { kind: "write", path: a, before: hash("a\n"), content: "A\n" },
    { kind: "write", path: b, before: null, content: "b\n" },
  );
  const onPhase = (index: number, phase: string): void => {
    if (index === 0 && phase === "settled") throw Object.assign(new Error(`EIO: i/o error in ${a}`), { code: "EIO" });
  };
  expect(() => run(store, value, { onPhase })).toThrow(/EIO/);
  expect(store.runs()[0]?.status).toBe("failed");
});

// A folder where a step expects a file is a finding, as when the plan is checked, not an error thrown out of apply.
test.each(["create", "replace", "delete"])(
  "a folder put at the path while the %s step is journaled is a finding",
  (kind) => {
    const { store, root, file } = fresh();
    const path = kind === "create" ? file("new.md") : file("old.md", "old\n");
    const race = (_: number, phase: string): void => {
      if (phase !== "journaled") return;
      rmSync(path, { force: true });
      mkdirSync(path);
    };
    const op = stepOf(kind, path);
    expect(run(store, plan(op), { onPhase: race })).toMatchObject({
      status: "failed",
      findings: [{ code: "plan.not-a-file", params: { path, error: expect.stringMatching(/^(EISDIR|EPERM)$/) } }],
    });
    expect(leftovers(root)).toEqual([]);
  },
);

test("a failed prune of old backups marks the new run failed before it reaches the caller, and writes nothing", () => {
  const { store, file } = fresh();
  const a = file("a.md", "a\n");
  vi.spyOn(store, "prune").mockImplementation(() => {
    throw new Error("EACCES: permission denied");
  });
  expect(() => run(store, plan({ kind: "write", path: a, before: hash("a\n"), content: "A\n" }))).toThrow(/EACCES/);
  expect([store.runs()[0]?.status, read(a)]).toEqual(["failed", "a\n"]);
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
  const [secret, key, made] = [file(".env.local", "TOKEN=1\n", 0o600), file("run.sh", "k\n", 0o755), file("new")];
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
  expect([read(secret), modeOf(secret), read(key), modeOf(key)]).toEqual(["TOKEN=1\n", 0o600, "k\n", 0o755]);
});

test("backups of runs older than 90 days go before the next apply; undo of such a run reports the missing backup", () => {
  const { store, state, file } = fresh();
  const path = file("a.md", "mine\n");
  const old = run(store, plan({ kind: "write", path, before: hash("mine\n"), content: "ours\n" }));
  const db = new DatabaseSync(join(state, "runs.sqlite"));
  db.prepare("UPDATE runs SET startedAt = '2000-01-01T00:00:00.000Z'").run();
  db.close();
  const other = plan({ kind: "write", path: file("b.md"), before: null, content: "b\n" });
  expect(apply(store, other, hash("not this plan")).status).toBe("refused");
  expect(existsSync(store.backupPath(old.runId ?? "", 0))).toBe(true);
  run(store, other);
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
