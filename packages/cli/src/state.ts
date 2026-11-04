import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

// The XDG Base Directory spec: an empty value means unset, and a relative one is invalid and ignored.
const absolute = (value: string | undefined): string | undefined => (value && isAbsolute(value) ? value : undefined);

/** The state folder: CEDARLOOM_STATE_DIR, else `cedarloom` in XDG_STATE_HOME, else in ~/.local/state; empty or relative values count as unset. */
export const stateDir = (env: Record<string, string | undefined>): string =>
  absolute(env["CEDARLOOM_STATE_DIR"]) ??
  join(absolute(env["XDG_STATE_HOME"]) ?? join(homedir(), ".local", "state"), "cedarloom");
