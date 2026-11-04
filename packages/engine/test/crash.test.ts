import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { recover, tempPath } from "@cedarloom/engine";
import { planHash } from "@cedarloom/ledger";
import { join } from "node:path";
import { expect, test } from "vitest";
import { hash, plan, read, storeAt, undo, workspace } from "./helpers.ts";

const OPERATIONS = 3;
const PHASES = 4;

const state = (path: string): string | null => (existsSync(path) ? read(path) : null);

// 0 never kills: the run completes. 1 to 12 kill the process after each phase of each operation.
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
    // Never a torn file: each one holds its old bytes or its new ones.
    expect(["kept\n", "changed\n"]).toContain(state(kept));
    expect([null, "made\n"]).toContain(state(made));
    expect(["gone\n", null]).toContain(state(gone));
    const store = storeAt(dir);
    recover(store);
    expect(readdirSync(root).filter((name) => name.includes(".cedarloom-"))).toEqual([]);
    expect(store.runs()[0]?.status).toBe(at === 0 ? "applied" : "interrupted");
    expect(undo(store, store.runs()[0]?.id ?? null)).toMatchObject({ status: "applied", skipped: [] });
    expect([state(kept), state(made), state(gone)]).toEqual(["kept\n", null, "gone\n"]);
    store.close();
  },
);

test("recovery removes the temporary file a step killed inside its write left next to the target", () => {
  const { root, state: dir, file } = workspace();
  const path = file("secret.env", "TOKEN=1\n");
  const value = plan({ kind: "write", path, before: hash("TOKEN=1\n"), content: "TOKEN=2\n" });
  const store = storeAt(dir);
  const begun = store.begin("apply", value, planHash(value));
  if (!begun.ok) throw new Error(begun.finding.code);
  store.start(begun.value, 0, 0o644);
  store.close();
  // An earlier open marked the run interrupted and the process died before recover ran.
  storeAt(dir).close();
  writeFileSync(tempPath(path, begun.value, 0), "TOKEN=2\n");
  const reopened = storeAt(dir);
  expect(reopened.interrupted).toEqual([]);
  recover(reopened);
  expect(readdirSync(root).filter((name) => name.includes(".cedarloom-"))).toEqual([]);
  reopened.close();
});
