import { homedir } from "node:os";
import { join } from "node:path";

/** The state folder: CEDARLOOM_STATE_DIR, else `cedarloom` in XDG_STATE_HOME, else in ~/.local/state. */
export const stateDir = (env: Record<string, string | undefined>): string =>
  env["CEDARLOOM_STATE_DIR"] ?? join(env["XDG_STATE_HOME"] ?? join(homedir(), ".local", "state"), "cedarloom");
