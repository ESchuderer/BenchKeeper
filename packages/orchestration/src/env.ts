// What a CLI needs to run, nothing that selects a login or changes the agent.
const INHERITED = ["PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "TZ"];
// Windows' system, profile and temp folders: docs/agents/git-and-processes.md#child-processes
const WINDOWS = ["SYSTEMROOT", "WINDIR", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP"];

/**
 * The network settings Claude Code documents: proxies (also lowercase), extra and system CAs, and an mTLS client
 * certificate (https://code.claude.com/docs/en/network-config). None selects a login.
 */
export const NETWORK_SETTINGS = [
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "NO_PROXY",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "CLAUDE_CODE_CERT_STORE",
  "CLAUDE_CODE_CLIENT_CERT",
  "CLAUDE_CODE_CLIENT_KEY",
  "CLAUDE_CODE_CLIENT_KEY_PASSPHRASE",
] as const;

/** What an agent process gets of the launcher's environment, by an allowlist: no login variable or hidden override. */
export const cleanEnv = (
  parent: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
  extra: readonly string[] = [],
): Record<string, string> => {
  // USER: Claude Code finds its macOS keychain login only with it (2.1.316: logged out under env -i with HOME, PATH).
  const own = [...(platform === "darwin" ? ["USER"] : []), ...(platform === "win32" ? WINDOWS : [])];
  const names = new Set([...INHERITED, ...own, ...extra]);
  // Only Windows names ignore case (it spells PATH as Path); elsewhere `path` or `Home` is another variable.
  const key = (name: string) => (platform === "win32" ? name.toUpperCase() : name);
  const inherited = Object.entries(parent).filter(
    (entry): entry is [string, string] => entry[1] !== undefined && names.has(key(entry[0])),
  );
  return Object.fromEntries(inherited);
};

/**
 * The hosts a worker reaches: GitHub only, until repositories name the package registries they need (owner decision,
 * 2026-11-06). Until then a package install fails: a tool that uses the sandbox proxy gets a 403 response from it, and
 * one that bypasses the proxy a name resolution error (https://code.claude.com/docs/en/sandboxing).
 */
export const GITHUB_DOMAINS = ["github.com", "*.github.com", "*.githubusercontent.com"] as const;
