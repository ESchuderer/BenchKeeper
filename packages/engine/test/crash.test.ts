import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { asidePath, recover, tempPath } from "@cedarloom/engine";
import { join } from "node:path";
import { expect, test } from "vitest";
import { hash, interruptedRun, plan, read, storeAt, undo, workspace } from "./helpers.ts";

const OPERATIONS = 3;
const PHASES = 5;

const state = (path: string): string | null => (existsSync(path) ? read(path) : null);

/** The bytes a step set aside for the file `name` in `root`, or null when there is no such file. */
const asideOf = (root: string, name: string): string | null => {
  const found = readdirSync(root).find((entry) => entry.startsWith(`.${name}.cedarloom-`) && entry.endsWith(".old"));
  return found === undefined ? null : read(join(root, found));
};

// 0 never kills: the run completes. 1 to 15 kill the process after each phase of each operation.
test.each(Array.from({ length: OPERATIONS * PHASES + 1 }, (_, at) => at))(
  "killed after phase %i of the apply, the next start recovers and undo restores every file",
  async (at) => {
    const { root, state: dir, file } = workspace();
    const [kept, made, gone] = [file("kept.md", "kept\n"), file("made.md"), file("gone.md", "gone\n")];
    const value = plan(
      { kind: "write", path: kept, before: hash("kept\n"), content: "changed\n" },
      { kind: "write", path: made, before: null, content: "made\n" },
      { kind: "delete", path: gone, before: hash("gone\n") },
    );
    writeFileSync(join(root, "plan.json"), JSON.stringify(value));
    const child = spawn(process.execPath, [
      join(import.meta.dirname, "fixtures", "crash.ts"),
      dir,
      join(root, "plan.json"),
      String(at),
    ]);
    const [code] = await once(child, "exit");
    // A killed process ends with no exit code on POSIX and with code 1 on Windows.
    expect(code === 0).toBe(at === 0);
    // Never a torn file: each one holds its old bytes or its new ones. Killed between setting a file aside and putting
    // the new one in, the path is empty and the old bytes wait aside for recovery.
    expect(["kept\n", "changed\n"]).toContain(state(kept) ?? asideOf(root, "kept.md"));
    expect([null, "made\n"]).toContain(state(made));
    expect(["gone\n", null]).toContain(state(gone) ?? asideOf(root, "gone.md"));
    const store = storeAt(dir);
    recover(store);
    expect(readdirSync(root).filter((name) => name.includes(".cedarloom-"))).toEqual([]);
    expect(["kept\n", "changed\n"]).toContain(state(kept));
    expect(store.runs()[0]?.status).toBe(at === 0 ? "applied" : "interrupted");
    expect(undo(store, store.runs()[0]?.id ?? null)).toMatchObject({ status: "applied", skipped: [] });
    expect([state(kept), state(made), state(gone)]).toEqual(["kept\n", null, "gone\n"]);
    store.close();
  },
);

test("recovery removes the temporary file a step killed inside its write left next to the target", () => {
  const { root, state: dir, file } = workspace();
  const path = file("secret.env", "TOKEN=1\n");
  const runId = interruptedRun(dir, plan({ kind: "write", path, before: hash("TOKEN=1\n"), content: "TOKEN=2\n" }));
  writeFileSync(tempPath(path, runId, 0), "TOKEN=2\n");
  const reopened = storeAt(dir);
  expect(reopened.interrupted).toEqual([]);
  recover(reopened);
  expect(readdirSync(root).filter((name) => name.includes(".cedarloom-"))).toEqual([]);
  reopened.close();
});

test("a run a crash interrupted keeps no file content in its stored plan once the store opens again", () => {
  const { state: dir, file } = workspace();
  const path = file("secret.env", "TOKEN=1\n");
  const runId = interruptedRun(dir, plan({ kind: "write", path, before: hash("TOKEN=1\n"), content: "TOKEN=2\n" }));
  const reopened = storeAt(dir);
  expect(reopened.run(runId)?.plan.operations).toEqual([
    { kind: "write", path, before: hash("TOKEN=1\n"), content: "" },
  ]);
  reopened.close();
});

// A step killed after it set its file aside: the kill matrix above reaches only the empty path. The other states come
// from a step killed between linking the new file in and removing the aside, or between putting a file back and
// removing its second name, or from another process that wrote the path after the kill.
test.each([
  ["the path is empty: the old file goes back", "empty", "kept\n", null],
  ["the path holds the new content: the aside goes", "new", "new\n", null],
  ["the path holds the new content, the aside an edit no backup has: both stay", "edited", "new\n", "kept, edited\n"],
  ["the path is the aside's own file: its second name goes", "same", "kept\n", null],
  ["another process wrote the path: both stay", "theirs", "theirs\n", "kept\n"],
  ["another process made a folder at the path: both stay", "folder", null, "kept\n"],
] as const)("recovery settles a file a killed step had set aside: %s", (_, at, path, aside) => {
  const { state: dir, file } = workspace();
  const target = file("kept.md", "kept\n");
  const runId = interruptedRun(dir, plan({ kind: "write", path: target, before: hash("kept\n"), content: "new\n" }));
  const moved = asidePath(target, runId, 0);
  renameSync(target, moved);
  if (at === "new" || at === "edited") writeFileSync(target, "new\n");
  // A write through a handle opened before the step's check, made after it, lands in the aside.
  if (at === "edited") writeFileSync(moved, "kept, edited\n");
  if (at === "same") linkSync(moved, target);
  if (at === "theirs") writeFileSync(target, "theirs\n");
  if (at === "folder") mkdirSync(target);
  const reopened = storeAt(dir);
  recover(reopened);
  const now = statSync(target).isDirectory() ? null : read(target);
  expect([now, state(moved)]).toEqual([path, aside]);
  reopened.close();
});

test.skipIf(process.platform === "win32")("recovery puts a link a killed step had set aside back as the link", () => {
  const { root, state: dir, file } = workspace();
  const [target, other] = [file("a.md", "a\n"), file("other.md", "other\n")];
  const runId = interruptedRun(dir, plan({ kind: "write", path: target, before: hash("a\n"), content: "A\n" }));
  // Killed while the step moved a link that had replaced the file back to its path.
  renameSync(target, join(root, "a.md.gone"));
  symlinkSync(other, asidePath(target, runId, 0));
  const store = storeAt(dir);
  recover(store);
  expect([lstatSync(target).isSymbolicLink(), read(target)]).toEqual([true, "other\n"]);
  expect(readdirSync(root).filter((name) => name.includes(".cedarloom-"))).toEqual([]);
  store.close();
});
