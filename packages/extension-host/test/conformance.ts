import type { Result } from "@cedarloom/contracts";
import type { RunningExtension } from "@cedarloom/extension-host";

// What the OS adds to every process it starts, whatever the environment it is given: macOS its text encoding, and on
// Windows libuv's required variables (https://github.com/libuv/libuv/blob/v1.x/src/win/process.c, required_vars),
// which hold paths and names but no token.
const INJECTED: Partial<Record<NodeJS.Platform, string[]>> = {
  darwin: ["__CF_USER_TEXT_ENCODING"],
  win32: ["HOMEDRIVE", "HOMEPATH", "LOGONSERVER", "PATH", "SYSTEMDRIVE", "SYSTEMROOT", "TEMP"].concat([
    "USERDOMAIN",
    "USERNAME",
    "USERPROFILE",
    "WINDIR",
  ]),
};

/**
 * The conformance kit: what an extension's process must be refused, however it is confined (plan section 4). The
 * flags-only launch of a bundled extension passes it now; an OS sandbox for extensions from elsewhere (Q8) must too.
 */
export const CONFORMANT = {
  write: "ERR_ACCESS_DENIED",
  writeOutside: "ERR_ACCESS_DENIED",
  readOutside: "ERR_ACCESS_DENIED",
  readOwn: "allowed",
  spawn: "ERR_ACCESS_DENIED",
  worker: "ERR_ACCESS_DENIED",
  network: "ERR_ACCESS_DENIED",
  dns: "ERR_ACCESS_DENIED",
  fetch: "TypeError: fetch failed",
  addon: "ERR_DLOPEN_DISABLED",
  // No file, folder or socket descriptor past stdio: Node's flags do not cover a descriptor a process was given.
  descriptor: "none",
  sqlite: "ERR_UNKNOWN_BUILTIN_MODULE",
  // Node's flags let a process signal any process of the user (and open another Node process's inspector): only an
  // OS sandbox refuses it, which it must (SANDBOX_ONLY).
  signal: "allowed",
  environment: INJECTED[process.platform] ?? [],
};

/** What the kit expects beyond CONFORMANT of an OS sandbox, which PR 12's sandbox must pass. */
export const SANDBOX_ONLY = { signal: "EPERM" };

/** Runs the fixture extension's `abuse` action, which tries each of them and answers what happened. */
export const conformance = async (extension: RunningExtension): Promise<Result<Record<string, unknown>>> => {
  const result = await extension.run({ action: "abuse", config: {}, inputs: {}, run: "conformance" });
  if (!result.ok) return result;
  // The environment's names in a fixed order: the OS adds them in its own.
  const environment: unknown = result.value["environment"];
  const names = Array.isArray(environment) ? environment.map(String) : [];
  return { ok: true, value: { ...result.value, environment: names.toSorted((a, b) => a.localeCompare(b)) } };
};
