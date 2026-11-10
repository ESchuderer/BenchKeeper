import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { cleanEnv } from "./env.ts";
import { githubRepo, type Remotes, TYPED_REMOTE } from "./guard.ts";
import { programPath } from "./program.ts";

// The remotes a git started with `env` lists for the folder, insteadOf rewrites applied; null when unreadable.
const remotesIn = (folder: string, typedUrl: string | undefined, env: NodeJS.ProcessEnv): ReturnType<Remotes> => {
  // git comes from an absolute folder of PATH: the hook runs outside the sandbox, where a relative entry would let the
  // session's own files stand in for it.
  const git = programPath("git", process.env);
  if (git === undefined) return null;
  // A name of its own per call, so that no remote the checkout configures (a pushurl) stands in for the typed URL.
  const own = `cedarloom-${randomUUID()}`;
  const typed = typedUrl === undefined ? [] : ["-c", `remote.${own}.url=${typedUrl}`];
  try {
    const listed = execFileSync(git, ["-c", "core.fsmonitor=false", ...typed, "-C", folder, "remote", "-v"], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      env,
    });
    const remotes = new Map<string, string[]>();
    for (const [, name = "", url = ""] of listed.matchAll(/^(\S+)\t(\S+) \((?:fetch|push)\)$/gm)) {
      remotes.set(name, [...new Set([...(remotes.get(name) ?? []), url])]);
    }
    return typedUrl === undefined ? remotes : new Map([[TYPED_REMOTE, remotes.get(own) ?? []]]);
  } catch {
    return null;
  }
};

/**
 * The fetch and push URLs of a folder's remotes as the session's git reads them, its GIT_* variables included: the
 * guard refuses a command that sets one, so the guarded command's git uses the same, and GIT_DIR or a GIT_CONFIG_*
 * rewrite names the repository it reaches.
 */
export const gitRemotes: Remotes = (folder, typedUrl) => remotesIn(folder, typedUrl, process.env);

/**
 * The folder's own remotes, whatever GIT_* variables the caller has: a hook's GIT_DIR would read another repository
 * (docs/agents/git-and-processes.md#git). For the CLI; the guard reads with gitRemotes.
 */
export const folderRemotes: Remotes = (folder, typedUrl) =>
  remotesIn(folder, typedUrl, {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key))),
    // Git never looks above the folder: one that is no repository takes nothing from the repository around it.
    GIT_CEILING_DIRECTORIES: dirname(folder),
  });

// A host alias as ~/.ssh/config names one: nothing ssh reads as an option (-), a token (%) or a shell word in `Match exec`.
const ALIAS = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,252}$/;

/**
 * The hostname OpenSSH's config gives a host alias (`ssh -G`); undefined for another word or without ssh.
 * shortcut: OpenSSH's config only, not core.sshCommand's or PuTTY's, and without git's user and port, so a `Match user`
 * or port branch can differ; upgrade when an owner's alias lives there.
 */
export const sshHostName = (alias: string): string | undefined => {
  if (!ALIAS.test(alias)) return undefined;
  const ssh = programPath("ssh", process.env);
  if (ssh === undefined) return undefined;
  try {
    const config = execFileSync(ssh, ["-G", "--", alias], {
      encoding: "utf8",
      timeout: 5000,
      killSignal: "SIGKILL",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      env: cleanEnv(process.env, process.platform),
    });
    // \r?: Win32-OpenSSH may end lines with CRLF.
    return /^hostname (\S+)\r?$/m.exec(config)?.[1];
  } catch {
    return undefined;
  }
};

// The GitHub repository of an SSH URL whose host is an alias; ssh.github.com is GitHub's SSH over port 443.
const aliasedRepo = (url: string, hostOf: (alias: string) => string | undefined): string | null => {
  let host = "";
  let path = "";
  if (url.includes("://")) {
    const parsed = URL.parse(url);
    if (parsed === null || !["ssh:", "git+ssh:", "ssh+git:"].includes(parsed.protocol)) return null;
    host = parsed.hostname;
    path = parsed.pathname;
  } else {
    const scp = /^(?:[^\s/@:]+@)?([^\s/@:]+):(.*)$/.exec(url);
    if (scp === null) return null;
    [, host = "", path = ""] = scp;
  }
  const name = hostOf(host);
  if (name === undefined) return null;
  return githubRepo(`git@${/^ssh\.github\.com$/i.test(name) ? "github.com" : name}:${path}`);
};

/**
 * The GitHub repositories of a folder's `origin` remote, its fetch and push URLs; none when git cannot read it. With
 * `hostOf`, also an SSH URL through a host alias whose hostname `hostOf` names as GitHub's; the guard passes none.
 */
export const originRepos = (
  folder: string,
  remotes: Remotes = gitRemotes,
  hostOf?: (alias: string) => string | undefined,
): string[] => {
  // Pending owner decision: origin only, not a fork's upstream; every remote is [...remotes.values()].flat().
  const urls = remotes(folder)?.get("origin") ?? [];
  const repos = urls.map((url) => githubRepo(url) ?? (hostOf === undefined ? null : aliasedRepo(url, hostOf)));
  return [...new Set(repos.filter((repo) => repo !== null))];
};
