import { spawn } from "node:child_process";
import type { Result } from "@cedarloom/contracts";

type Command = readonly [string, ...string[]];

// gh exits 1 when it finds no token; a gh that is not installed finds none either.
const NO_TOKEN = new Set<number | string>([1, "ENOENT"]);

/**
 * ARW1-8: refuses a launch while gh still finds a token without GH_TOKEN, such as the keyring login of `gh auth login`.
 * gh runs with the worker's environment minus GH_TOKEN and no output, so a token it prints never reaches the launcher.
 * Any outcome but gh's "no token" refuses: the probe fails closed. A gh not found on the worker's PATH counts as none.
 */
export const ghProbe = async (
  env: Readonly<Record<string, string>>,
  command: Command = ["gh"],
): Promise<Result<null>> => {
  const [file, ...prefix] = command;
  const without = Object.fromEntries(Object.entries(env).filter(([name]) => name.toUpperCase() !== "GH_TOKEN"));
  const child = spawn(file, [...prefix, "auth", "token"], {
    env: without,
    stdio: "ignore",
    timeout: 10_000,
    windowsHide: true,
  });
  // An exit code (0: gh has a token), a spawn error code such as EACCES, or "killed" when it ended by a signal.
  const outcome = await new Promise<number | string>((resolve) => {
    child.once("error", (error) => resolve(String(Reflect.get(error, "code"))));
    child.once("exit", (code) => resolve(code ?? "killed"));
  });
  if (NO_TOKEN.has(outcome)) return { ok: true, value: null };
  return { ok: false, finding: { code: "launch.gh-login", params: { error: outcome === 0 ? null : String(outcome) } } };
};
