// Runs the workflow file argv[4] in the project argv[3] with the state folder argv[2], and kills this process (SIGKILL,
// no cleanup) right after the argv[5]-th event is committed.
import { runWorkflow } from "@cedarloom/use-cases";

const [state = "", project = "", file = "", at = "0"] = process.argv.slice(2);
let events = 0;
const onEvent = (): void => {
  events += 1;
  if (events === Number(at)) process.kill(process.pid, "SIGKILL");
};
await runWorkflow(state, file, {}, { project, onEvent });
