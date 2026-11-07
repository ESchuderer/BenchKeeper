import { spawn } from "node:child_process";
import type { Result } from "@cedarloom/contracts";
import { programPath } from "./program.ts";

type Command = readonly [string, ...string[]];

// gh exits 1 when it finds no token; a gh that is not installed finds none either.
const NO_TOKEN = new Set<number | string>([1, "ENOENT"]);

/**
 * ARW1-8: refuses a launch while gh still finds a token without GH_TOKEN, such as the keyring login of `gh auth login`.
 * gh runs with the worker's environment minus GH_TOKEN and no output, so a token it prints never reaches the launcher.
 * Any outcome but gh's "no token" refuses: the probe fails closed. A gh not found in an absolute folder of the worker's PATH counts as none.
 */
export const ghProbe = async (
  env: Readonly<Record<string, string>>,
  command: Command = ["gh"],
  timeoutMs = 10_000,
): Promise<Result<null>> => {
  const [name, ...prefix] = command;
  const without = Object.fromEntries(Object.entries(env).filter(([key]) => key.toUpperCase() !== "GH_TOKEN"));
  const file = programPath(name, without);
  if (file === undefined) return { ok: true, value: null };
  // An exit code (0: gh has a token), a spawn error code such as EACCES, or "killed" when it ended by a signal.
  const outcome = await new Promise<number | string>((resolve) => {
    const failed = (error: unknown) => resolve(String(Reflect.get(Object(error), "code")));
    try {
      // SIGKILL on the timeout: a gh that ignores SIGTERM would keep the launch waiting.
      const options = {
        env: without,
        stdio: "ignore",
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        windowsHide: true,
      } as const;
      const child = spawn(file, [...prefix, "auth", "token"], options);
      child.once("error", failed);
      child.once("exit", (code) => resolve(code ?? "killed"));
    } catch (error) {
      // Some spawn errors, such as ENOTDIR, are thrown at once rather than emitted.
      failed(error);
    }
  });
  if (NO_TOKEN.has(outcome)) return { ok: true, value: null };
  return { ok: false, finding: { code: "launch.gh-login", params: { error: outcome === 0 ? null : String(outcome) } } };
};
