// Opens the store in argv[2], starts a run and keeps the store until the test kills this process.
import { openRunStore, planHash } from "@cedarloom/ledger";
import type { Plan } from "@cedarloom/contracts";

const dir = process.argv[2] ?? "";
const plan: Plan = { schemaVersion: 1, operations: [{ kind: "write", path: "/x", before: null, content: "x" }] };
const store = openRunStore(dir);
if (!store.ok) throw new Error(store.finding.code);
store.value.begin("apply", plan, planHash(plan));
process.stdout.write("ready\n");
// The reference keeps the store, and with it the lock, from being collected while the test runs.
setInterval(() => store, 60_000);
