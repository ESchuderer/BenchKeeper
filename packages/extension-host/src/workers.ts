import { PlainText } from "@cedarloom/contracts";
import type { WorkerAnswers, WorkerCall } from "@cedarloom/extension-sdk";
import { z } from "zod";

// A runner's handle or dispatch id, as Orca's are: bounded, printable, no spaces.
const Handle = z.string().regex(/^[\w.:@-]{1,200}$/);

/** What each call of a worker runner answers (protocol `worker/*`); the host refuses anything else. */
export const WORKER_ANSWERS: { [C in WorkerCall]: z.ZodType<WorkerAnswers[C]> } = {
  "worker/start": z.strictObject({ dispatch: Handle, handles: z.array(Handle).max(8) }),
  "worker/show": z.strictObject({ state: PlainText.min(1).max(64), settled: z.boolean() }),
  "worker/release": z.strictObject({ released: z.boolean() }),
};
