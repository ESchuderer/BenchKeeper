// Applies the plan in argv[3] to the store in argv[2] and kills this process at the argv[4]-th phase (SIGKILL, no cleanup).
import { readFileSync } from "node:fs";
import { PLAN_SCHEMA_VERSION, Plan, readDocument } from "@cedarloom/contracts";
import { apply } from "@cedarloom/engine";
import { openRunStore, planHash } from "@cedarloom/ledger";

const [dir = "", file = "", at = "0"] = process.argv.slice(2);
const plan = readDocument(Plan, PLAN_SCHEMA_VERSION, JSON.parse(readFileSync(file, "utf8")));
const store = openRunStore(dir);
if (!plan.ok || !store.ok) throw new Error("fixture setup");
let phases = 0;
apply(store.value, plan.value, planHash(plan.value), {
  onPhase: () => {
    phases += 1;
    if (phases === Number(at)) process.kill(process.pid, "SIGKILL");
  },
});
