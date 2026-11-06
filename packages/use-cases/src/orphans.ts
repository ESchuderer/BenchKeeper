import { type ChildProcess, execFileSync } from "node:child_process";
import { win32 } from "node:path";
import type { NodeAttempt } from "@cedarloom/contracts";
import { cleanEnv } from "@cedarloom/orchestration";

/**
 * Ends the process `pid` with its whole tree: its process group, or on Windows taskkill /T and then `child`'s own kill
 * (the shell, should taskkill have missed it).
 */
export const stopTree = (pid: number, child?: Pick<ChildProcess, "kill">): void => {
  /* v8 ignore start -- Windows only; the Windows CI leg runs it */
  if (process.platform === "win32") {
    const taskkill = win32.join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "taskkill.exe");
    try {
      execFileSync(taskkill, ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", timeout: 5000 });
    } catch {
      // The tree has ended meanwhile, or taskkill failed or timed out.
    }
    child?.kill();
    return;
  }
  /* v8 ignore stop */
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // It has ended meanwhile.
  }
};

// When the process `pid` started, in milliseconds, to the second (`ps` gives no zone, so local time); NaN when there
// is no such process. By its path: a `ps` found on PATH could be any program.
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

// How long before its record an attempt's process may have started: a process that started earlier is another one,
// such as one in the hour a clock goes back (`ps` gives local time) or in another pid namespace.
const SPAWN_MS = 60_000;

/**
 * Stops what a runner that died left running: the process of each attempt still marked running, with its tree, when
 * it started in the minute before the attempt's start was recorded. A later process that reuses the pid started after
 * that, and is left alone; `ps` tells the start to the second, so one that ended and was reused within the second of the
 * record would be taken for it. A command whose shell has ended, while a child of it runs on, is not found this way. On
 * Windows a runner's shell ends with the runner (Node's job object kills it on close), so there is nothing to stop; the
 * shell's own children may outlive it (hub issue 103).
 */
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
