// Holds the store in argv[2] and applies a plan of one file the way the engine journals it: the step started, then,
// once a line comes on stdin, its file written and synced, the step settled, the run finished. Prints "applying" when
// the step is journaled, so the test acts while the apply is under way.
import { closeSync, fsyncSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { Plan } from "@cedarloom/contracts";
import { openRunStore, planHash } from "@cedarloom/ledger";

const [dir = ""] = process.argv.slice(2);
const store = openRunStore(dir);
if (!store.ok) throw new Error(store.finding.code);
const path = join(dir, "written");
const plan: Plan = { schemaVersion: 1, operations: [{ kind: "write", path, before: null, content: "x" }] };
const run = store.value.begin("apply", plan, planHash(plan));
if (!run.ok) throw new Error(run.finding.code);
store.value.start(run.value, 0, null);
process.stdout.write("applying\n");
process.stdin.once("data", () => {
  const fd = openSync(path, "w");
  writeSync(fd, "x");
  fsyncSync(fd);
  closeSync(fd);
  store.value.settle(run.value, 0, "done");
  store.value.finish(run.value, "applied");
  store.value.close();
});
