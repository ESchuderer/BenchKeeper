import { execFileSync } from "node:child_process";
import { win32 } from "node:path";
import type { NodeAttempt } from "@cedarloom/contracts";
import { cleanEnv } from "@cedarloom/orchestration";

/** Ends the process `pid` with its whole tree: its process group, or on Windows taskkill /T. */
export const stopTree = (pid: number): void => {
  try {
    /* v8 ignore start -- Windows only; the Windows CI leg runs it */
    if (process.platform === "win32") {
      const taskkill = win32.join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "taskkill.exe");
      execFileSync(taskkill, ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      return;
    }
    /* v8 ignore stop */
    process.kill(-pid, "SIGKILL");
  } catch {
    // It has ended meanwhile.
  }
};

// When the process `pid` started, in milliseconds, to the second; NaN when there is no such process.
const startOf = (pid: number): number => {
  try {
    /* v8 ignore start -- Windows only; the Windows CI leg runs it */
    if (process.platform === "win32") {
      const time = `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().ToString("o")`;
      return Date.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", time], { encoding: "utf8" }));
    }
    /* v8 ignore stop */
    const env = { ...cleanEnv(process.env, process.platform), LC_ALL: "C" };
    return Date.parse(execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", env }));
  } catch {
    return Number.NaN;
  }
};

/**
 * Stops what a runner that died left running: the process of each attempt still marked running, with its tree, when
 * it started no later than the attempt's start was recorded. A later process that reuses the pid started after that,
 * and is left alone; `ps` tells the start to the second, so one that ended and was reused within the second of the
 * record would be taken for it. A command whose shell has ended, while a child of it runs on, is not found this way.
 */
export const stopOrphans = (attempts: readonly NodeAttempt[]): void => {
  for (const { state, pid, startedAt } of attempts) {
    // Never 1 (a negative 1 would reach every process) or this process.
    const ours = state === "running" && pid !== null && pid > 1 && pid !== process.pid;
    if (ours && startOf(pid) <= Date.parse(startedAt)) stopTree(pid);
  }
};
