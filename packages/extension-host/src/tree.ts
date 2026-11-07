import { type ChildProcess, execFileSync } from "node:child_process";
import { win32 } from "node:path";

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
