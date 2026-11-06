// Takes over the graph run argv[3] in the store argv[2], prints the epoch it took, and holds the run until it is killed.
import { openGraphStore } from "@cedarloom/ledger";

const [dir = "", runId = ""] = process.argv.slice(2);
const store = openGraphStore(dir);
if (!store.ok) throw new Error(store.finding.code);
const lease = store.value.takeOver(runId);
if (!lease.ok) throw new Error(lease.finding.code);
process.stdout.write(`${lease.value.epoch}\n`);
setInterval(() => {}, 1000);
