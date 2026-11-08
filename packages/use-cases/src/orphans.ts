import { execFileSync } from "node:child_process";
import type { NodeAttempt } from "@cedarloom/contracts";
import { stopTree } from "@cedarloom/extension-host";
import { cleanEnv } from "@cedarloom/orchestration";

// When `pid` started, to the second (`ps` gives local time); NaN when there is none. `ps` by its path, not from PATH.
const startOf = (pid: number): number => {
  const env = { ...cleanEnv(process.env, process.platform), LC_ALL: "C" };
  try {
    return Date.parse(
      execFileSync("/bin/ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", env, timeout: 5000 }),
    );
  } catch {
    return Number.NaN;
  }
};

// A process older than its record by over a minute is another one (a clock going back, another pid namespace).
const SPAWN_MS = 60_000;

// Stops what a dead runner's attempts left running: docs/agents/git-and-processes.md#child-processes
export const stopOrphans = (attempts: readonly NodeAttempt[]): void => {
  /* v8 ignore next -- Windows only */
  if (process.platform === "win32") return;
  for (const { state, pid, startedAt } of attempts) {
    // Never 1 (a negative 1 would reach every process) or this process.
    const ours = state === "running" && pid !== null && pid > 1 && pid !== process.pid;
    const recorded = Date.parse(startedAt);
    const started = ours ? startOf(pid) : Number.NaN;
    if (started <= recorded && started >= recorded - SPAWN_MS) stopTree(Number(pid));
  }
};
