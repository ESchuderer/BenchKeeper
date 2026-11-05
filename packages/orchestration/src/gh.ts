import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Result } from "@cedarloom/contracts";

type Command = readonly [string, ...string[]];

// gh exits 1 when it finds no token; a gh that is not installed finds none either.
const NO_TOKEN = new Set<unknown>([1, "ENOENT"]);

/**
 * ARW1-8: refuses a launch while gh still finds a token without GH_TOKEN, such as the keyring login of `gh auth login`.
 * gh runs with the worker's environment minus GH_TOKEN. Any outcome but gh's "no token" refuses: the probe fails closed.
 */
export const ghProbe = async (
  env: Readonly<Record<string, string>>,
  command: Command = ["gh"],
): Promise<Result<null>> => {
  const [file, ...prefix] = command;
  const without = Object.fromEntries(Object.entries(env).filter(([name]) => name.toUpperCase() !== "GH_TOKEN"));
  try {
    // Exit 0 is gh printing a token.
    await promisify(execFile)(file, [...prefix, "auth", "token"], { env: without, timeout: 10_000, windowsHide: true });
    return { ok: false, finding: { code: "launch.gh-login", params: { error: null } } };
  } catch (error) {
    // An exit code, a spawn error code such as EACCES, or none when gh was killed, by the timeout among others.
    const code: unknown = Reflect.get(Object(error), "code");
    if (NO_TOKEN.has(code)) return { ok: true, value: null };
    const why = typeof code === "number" || typeof code === "string" ? String(code) : "killed";
    return { ok: false, finding: { code: "launch.gh-login", params: { error: why } } };
  }
};
