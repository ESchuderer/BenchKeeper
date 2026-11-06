// Runs the workflow file argv[4] in the project argv[3] with the state folder argv[2], and kills this process (SIGKILL,
// no cleanup) right after the argv[5]-th event is committed. Prints "started" once an attempt has started, and turns
// SIGTERM into a cancel of the run, as the CLI does.
import type { JournalEvent } from "@cedarloom/contracts";
import { runWorkflow } from "@cedarloom/use-cases";

const [state = "", project = "", file = "", at = "0"] = process.argv.slice(2);
const stop = new AbortController();
process.once("SIGTERM", () => stop.abort());
let events = 0;
const onEvent = (event: JournalEvent): void => {
  events += 1;
  if (events === Number(at)) process.kill(process.pid, "SIGKILL");
  if (event.type === "started") process.stdout.write("started\n");
};
await runWorkflow(state, file, {}, { project, onEvent, signal: stop.signal });
