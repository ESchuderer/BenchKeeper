import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { githubRepo, type Remotes, TYPED_REMOTE } from "./guard.ts";
import { programPath } from "./program.ts";

/**
 * The fetch and push URLs of a folder's remotes as git reads them, insteadOf rewrites applied; null when unreadable.
 * git comes from an absolute folder of PATH: the hook runs outside the sandbox, where a relative entry would let the
 * session's own files stand in for it.
 */
export const gitRemotes: Remotes = (folder, typedUrl) => {
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

/** The GitHub repositories of a folder's `origin` remote, its fetch and push URLs; none when git cannot read it. */
export const originRepos = (folder: string, remotes: Remotes = gitRemotes): string[] => {
  // Pending owner decision: origin only, not a fork's upstream; every remote is [...remotes.values()].flat().
  const urls = remotes(folder)?.get("origin") ?? [];
  return [...new Set(urls.map(githubRepo).filter((repo) => repo !== null))];
};
