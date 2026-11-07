// Throwaway trial for hub issue 142, not for merge: which processes of a host killed on Windows keep running.
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { expect, test } from "vitest";

const fixtures = join(import.meta.dirname, "fixtures");
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test.runIf(process.platform === "win32")(
  "trial 142: the processes of a host killed with taskkill /F",
  async () => {
    const host = spawn(process.execPath, [join(fixtures, "host.ts")], { stdio: ["ignore", "pipe", "inherit"] });
    const [line] = await once(host.stdout, "data");
    const pids: Record<string, number> = JSON.parse(String(line));
    const before = Object.fromEntries(Object.entries(pids).map(([name, pid]) => [name, alive(pid)]));
    execFileSync("taskkill", ["/F", "/PID", String(host.pid)]);
    await once(host, "exit");
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const after = Object.fromEntries(Object.entries(pids).map(([name, pid]) => [name, alive(pid)]));
    console.log(`TRIAL-142 ${JSON.stringify({ os: process.platform, node: process.version, pids, before, after })}`);
    for (const pid of Object.values(pids)) {
      try {
        execFileSync("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore" });
      } catch {
        // gone already
      }
    }
    expect(Object.values(before).every(Boolean)).toBe(true);
  },
  60_000,
);
