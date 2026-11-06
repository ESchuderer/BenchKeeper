import type { Result } from "@cedarloom/contracts";
import type { RunningPlugin } from "@cedarloom/plugin-host";

/**
 * The conformance kit: what a plugin's process must be refused, however it is confined. The flags-only launch of a
 * bundled plugin passes it now; an OS sandbox for plugins from elsewhere (Q8) must pass it too.
 */
export const CONFORMANT = {
  write: "ERR_ACCESS_DENIED",
  writeTemp: "ERR_ACCESS_DENIED",
  readOutside: "ERR_ACCESS_DENIED",
  readOwn: "allowed",
  spawn: "ERR_ACCESS_DENIED",
  worker: "ERR_ACCESS_DENIED",
  network: "ERR_ACCESS_DENIED",
  environment: [],
};

/** Runs the fixture plugin's `abuse` action, which tries each of them and answers what happened. */
export const conformance = (plugin: RunningPlugin): Promise<Result<Record<string, unknown>>> =>
  plugin.run({ action: "abuse", config: {}, inputs: {}, run: "conformance" });
