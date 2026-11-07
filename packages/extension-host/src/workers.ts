import { PlainText } from "@cedarloom/contracts";
import type { WorkerAnswers, WorkerCall, WorkerCallParams } from "@cedarloom/extension-sdk";
import { z } from "zod";

// A runner's handle or dispatch id, as Orca's are: bounded, printable, no spaces.
const Handle = z.string().regex(/^[\w.:@-]{1,200}$/);

/** What each call of a worker runner answers (protocol `worker/*`); the host refuses anything else. */
export const WORKER_ANSWERS: { [C in WorkerCall]: z.ZodType<WorkerAnswers[C]> } = {
  "worker/start": z.strictObject({ dispatch: Handle, handles: z.array(Handle).max(8) }),
  "worker/show": z.strictObject({ state: PlainText.min(1).max(64), settled: z.boolean() }),
  "worker/release": z.strictObject({ released: z.boolean() }),
};

// What host/exec takes as one argument: a launch line's word, the spec.
const Word = z
  .string()
  .min(1)
  .max(32 * 1024);
const Path = z.string().min(1).max(4096);
/** What the host asks a worker runner: a launch line of at least its program, and bounded words, paths and handles. */
export const WORKER_PARAMS: { [C in WorkerCall]: z.ZodType<WorkerCallParams[C]> } = {
  "worker/start": z.strictObject({
    runner: z.string(),
    worktree: Path,
    line: z.array(Word).min(1).max(200),
    spec: Word,
    title: PlainText.min(1).max(200),
    repository: Path,
  }),
  "worker/show": z.strictObject({ runner: z.string(), dispatch: Handle }),
  "worker/release": z.strictObject({ runner: z.string(), handles: z.array(Handle).max(8) }),
};
