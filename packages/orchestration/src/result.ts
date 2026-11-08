import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { readDocument, WORKER_RESULT_SCHEMA_VERSION, WorkerResult } from "@cedarloom/contracts";

// A valid result holds a summary of 2,000 characters at most, so a larger file is refused unparsed.
const MAX_BYTES = 64 * 1024;
// No link is followed and a FIFO the worker placed does not block; Windows lacks both flags, which then or in as 0.
const { O_NOFOLLOW, O_NONBLOCK, O_RDONLY } = constants;

/**
 * The result the worker of run `runId` wrote: null when the file is missing, no regular file, too large, no valid
 * result, or the result of another run. The worker writes it, so it is read as untrusted input.
 */
export const readResult = (path: string, runId: string): WorkerResult | null => {
  let fd: number;
  try {
    fd = openSync(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    if (!fstatSync(fd).isFile()) return null;
    // At most one byte past the limit is read, even when the worker grows the file after the open.
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    const size = readSync(fd, buffer, 0, buffer.length, 0);
    if (size > MAX_BYTES) return null;
    const text = buffer.subarray(0, size).toString("utf8");
    const result = readDocument(WorkerResult, WORKER_RESULT_SCHEMA_VERSION, JSON.parse(text));
    return result.ok && result.value.runId === runId ? result.value : null;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
};

/** What a worker's prompt says about the result file it ends with. */
export const resultPrompt = (path: string, runId: string): string =>
  [
    `When you are done, write your result to ${path} as this JSON object and nothing else:`,
    JSON.stringify({
      schemaVersion: WORKER_RESULT_SCHEMA_VERSION,
      runId,
      verdict: "pass | findings | not-run",
      summary: "what you did and found, 2,000 characters at most",
    }),
    "verdict: pass when the task is done and its checks pass, findings when problems remain, not-run when you could not do the task.",
  ].join("\n");
