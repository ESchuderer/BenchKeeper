// Records runs into the store in argv[2] for argv[3] ms, each from a fresh open as one CLI apply after another does:
// the last close of each cleans up the WAL, which briefly locks readers out.
import { openRunStore, planHash } from "@cedarloom/ledger";
import type { Plan } from "@cedarloom/contracts";

const [dir = "", ms = "0"] = process.argv.slice(2);
process.stdout.write("ready\n");
for (let i = 0, end = Date.now() + Number(ms); Date.now() < end; i += 1) {
  const store = openRunStore(dir);
  if (!store.ok) throw new Error(store.finding.code);
  const plan: Plan = { schemaVersion: 1, operations: [{ kind: "write", path: `/w/${i}`, before: null, content: "x" }] };
  const run = store.value.begin("apply", plan, planHash(plan));
  if (run.ok) store.value.finish(run.value, "applied");
  store.value.close();
}
