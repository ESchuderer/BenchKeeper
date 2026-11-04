import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, writeFileSync } from "node:fs";
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
    const [code, signal] = await once(child, "exit");
    expect(at === 0 ? code : signal).toBe(at === 0 ? 0 : "SIGKILL");
    // Never a torn file: each one holds its old bytes or its new ones.
    expect(["kept\n", "changed\n"]).toContain(state(kept));
    expect([null, "made\n"]).toContain(state(made));
    expect(["gone\n", null]).toContain(state(gone));
    const store = storeAt(dir);
    expect(store.runs()[0]?.status).toBe(at === 0 ? "applied" : "interrupted");
    expect(undo(store, store.runs()[0]?.id ?? null)).toMatchObject({ status: "applied", skipped: [] });
    expect([state(kept), state(made), state(gone)]).toEqual(["kept\n", null, "gone\n"]);
    store.close();
  },
);
