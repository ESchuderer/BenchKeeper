import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

type Env = Record<string, string | undefined>;

// The XDG Base Directory spec: an empty value means unset, and a relative one is invalid and ignored.
const absolute = (value: string | undefined): string | undefined => (value && isAbsolute(value) ? value : undefined);

const folder = (env: Env, own: string, xdg: string, fallback: string): string =>
  absolute(env[own]) ?? join(absolute(env[xdg]) ?? join(homedir(), fallback), "cedarloom");

/** The state folder: CEDARLOOM_STATE_DIR, else `cedarloom` in XDG_STATE_HOME, else in ~/.local/state; empty or relative values count as unset. */
export const stateDir = (env: Env): string =>
  folder(env, "CEDARLOOM_STATE_DIR", "XDG_STATE_HOME", join(".local", "state"));

/** The config folder, which holds the account registry: CEDARLOOM_CONFIG_DIR, else `cedarloom` in XDG_CONFIG_HOME, else in ~/.config. */
export const configDir = (env: Env): string => folder(env, "CEDARLOOM_CONFIG_DIR", "XDG_CONFIG_HOME", ".config");
