import type { Result } from "@cedarloom/contracts";
import type { RunningPlugin } from "@cedarloom/plugin-host";

/**
 * The conformance kit: what a plugin's process must be refused, however it is confined. The flags-only launch of a
 * bundled plugin passes it now; an OS sandbox for plugins from elsewhere (Q8) must pass it too.
 */
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

export const CONFORMANT = {
  write: "ERR_ACCESS_DENIED",
  writeOutside: "ERR_ACCESS_DENIED",
  readOutside: "ERR_ACCESS_DENIED",
  readOwn: "allowed",
  spawn: "ERR_ACCESS_DENIED",
  worker: "ERR_ACCESS_DENIED",
  network: "ERR_ACCESS_DENIED",
  environment: INJECTED[process.platform] ?? [],
};

/** Runs the fixture plugin's `abuse` action, which tries each of them and answers what happened. */
export const conformance = async (plugin: RunningPlugin): Promise<Result<Record<string, unknown>>> => {
  const result = await plugin.run({ action: "abuse", config: {}, inputs: {}, run: "conformance" });
  if (!result.ok) return result;
  // The environment's names in a fixed order: the OS adds them in its own.
  const environment: unknown = result.value["environment"];
  const names = Array.isArray(environment) ? environment.map(String) : [];
  return { ok: true, value: { ...result.value, environment: names.toSorted((a, b) => a.localeCompare(b)) } };
};
