import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { readDocument, WORKER_RESULT_SCHEMA_VERSION, WorkerResult } from "@cedarloom/contracts";

// A valid result holds a summary of 2,000 characters at most, so a larger file is refused unread.
const MAX_BYTES = 64 * 1024;
// No symbolic link is followed, and a FIFO the worker put in place does not block the open. Windows has neither flag,
// and a missing one counts as 0 in a bitwise or.
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
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_BYTES) return null;
    const result = readDocument(WorkerResult, WORKER_RESULT_SCHEMA_VERSION, JSON.parse(readFileSync(fd, "utf8")));
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
