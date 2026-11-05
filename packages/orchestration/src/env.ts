import { join } from "node:path";
import type { AccountRegistry } from "@cedarloom/contracts";

// What a worker inherits from the launcher: what a CLI needs to run, nothing that selects a login or changes the agent.
// USER on macOS: Claude Code finds its keychain login only with it (2.1.316: logged out under env -i with HOME and PATH).
const INHERITED = ["PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "TZ"];

export interface WorkerEnvInput {
  readonly parent: Readonly<Record<string, string | undefined>>;
  readonly platform: NodeJS.Platform;
  /** The fine-grained token of the worker's access profile; null when it has none. */
  readonly ghToken: string | null;
  /** An empty folder of this worker for gh's configuration. */
  readonly ghConfigDir: string;
}

/**
 * A worker's environment, built from an allowlist: no login variable, hidden override or token of the launcher reaches
 * it. gh gets the access profile's token and an empty configuration folder of its own, so it never falls back to the
 * keyring login of `gh auth login`.
 */
export const workerEnv = ({ parent, platform, ghToken, ghConfigDir }: WorkerEnvInput): Record<string, string> => {
  const names = new Set(platform === "darwin" ? [...INHERITED, "USER"] : INHERITED);
  // Windows spells PATH as Path: names compare without regard to case.
  const inherited = Object.entries(parent).filter(
    (entry): entry is [string, string] => entry[1] !== undefined && names.has(entry[0].toUpperCase()),
  );
  return {
    ...Object.fromEntries(inherited),
    GH_CONFIG_DIR: ghConfigDir,
    ...(ghToken === null ? {} : { GH_TOKEN: ghToken }),
  };
};

// The user's credential folders and the agents' default homes, below the user's home folder.
const CREDENTIALS = [
  ".ssh",
  ".gnupg",
  ".aws",
  ".azure",
  ".docker",
  ".netrc",
  join(".config", "gh"),
  join(".config", "gcloud"),
  ".claude",
  ".claude.json",
  ".codex",
];

/**
 * What a worker must not read: every account's home, its own too, since the agent process reads its login and no shell
 * command needs it, and the user's credential folders.
 */
export const deniedPaths = (registry: AccountRegistry, home: string): string[] => [
  ...registry.accounts.map((account) => account.home),
  ...CREDENTIALS.map((path) => join(home, path)),
];

/**
 * The hosts a worker reaches: GitHub only, until repositories name the package registries they need (pending owner
 * decision). Until then a package install fails: a tool that uses the sandbox proxy gets a 403 response from it, and
 * one that bypasses the proxy a name resolution error (https://code.claude.com/docs/en/sandboxing).
 */
export const GITHUB_DOMAINS = ["github.com", "*.github.com", "*.githubusercontent.com"] as const;
