import { type ChildProcess, execFileSync } from "node:child_process";
import { win32 } from "node:path";

/**
 * Ends the process `pid` with its whole tree: its process group, or on Windows taskkill /T and then `child`'s own kill
 * (the shell, should taskkill have missed it).
 */
export const stopTree = (pid: number, child?: Pick<ChildProcess, "kill" | "exitCode" | "signalCode">): void => {
  /* v8 ignore start -- Windows only; the Windows CI leg runs it */
  if (process.platform === "win32") {
    // Once `child` has exited, Windows may give its process ID to another process, whose tree taskkill would end. A
    // POSIX process group lives on while any member does, so there it still ends the background children.
    if (child !== undefined && (child.exitCode !== null || child.signalCode !== null)) return;
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
