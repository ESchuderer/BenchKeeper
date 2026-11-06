// Holds the store in argv[2] for argv[3] ms and applies plans of three files the way the engine journals them: each
// step started, its file written and synced, the step settled, the run finished.
import { closeSync, fsyncSync, mkdirSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { Plan } from "@cedarloom/contracts";
import { openRunStore, planHash } from "@cedarloom/ledger";

const [dir = "", ms = "0"] = process.argv.slice(2);
const store = openRunStore(dir);
if (!store.ok) throw new Error(store.finding.code);
const files = join(dir, "files");
mkdirSync(files);
process.stdout.write("ready\n");
for (let i = 0, end = Date.now() + Number(ms); Date.now() < end; i += 1) {
  const paths = [0, 1, 2].map((n) => join(files, `${i}-${n}`));
  const plan: Plan = {
    schemaVersion: 1,
    operations: paths.map((path) => ({ kind: "write", path, before: null, content: "x" })),
  };
  const run = store.value.begin("apply", plan, planHash(plan));
  if (!run.ok) throw new Error(run.finding.code);
  paths.forEach((path, index) => {
    store.value.start(run.value, index, null);
    const fd = openSync(path, "w");
    writeSync(fd, "x");
    fsyncSync(fd);
    closeSync(fd);
    store.value.settle(run.value, index, "done");
  });
  store.value.finish(run.value, "applied");
}
store.value.close();
