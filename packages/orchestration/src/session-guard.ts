import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GUARD_SCHEMA_VERSION, type GuardPolicy, RepoName } from "@cedarloom/contracts";
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
export const originRepos = (folder: string): string[] => {
  // Pending owner decision: origin only, not a fork's upstream; every remote is [...remotes.values()].flat().
  const urls = gitRemotes(folder)?.get("origin") ?? [];
  return [...new Set(urls.map(githubRepo).filter((repo) => repo !== null))];
};

// A binding the policy cannot hold, such as owner/., counts as none.
const held = (repo: string | undefined): string | null =>
  repo !== undefined && RepoName.safeParse(repo).success ? repo : null;

/**
 * A worker's guard policy: the GitHub repositories of its project's origin, the hub and the memory repository, both from
 * this machine's bindings. A push to the memory repository reaches its `memory/` branches only (A14).
 */
export const workerPolicy = (
  project: string,
  bindings: { readonly hub?: string | undefined; readonly memory?: string | undefined },
): GuardPolicy => {
  const [hub, memory] = [held(bindings.hub), held(bindings.memory)];
  const named = [...originRepos(project), hub, memory].filter((repo) => repo !== null);
  return { schemaVersion: GUARD_SCHEMA_VERSION, repositories: [...new Set(named)], hub, memory };
};

// The root folder of a CedarLoom package, from the file its entry resolves to (src/ or dist/).
const packageRoot = (specifier: string): string => dirname(dirname(fileURLToPath(import.meta.resolve(specifier))));

/**
 * The guard hook of a session under `policy`: this Node.js runs the hook's file, the policy's JSON its argument (no
 * shell), and the session may change neither the hook's package nor the contracts it reads the policy with.
 */
export const guardHookOf = (policy: GuardPolicy): { command: string; args: string[]; files: string[] } => {
  const hook = fileURLToPath(import.meta.resolve("@cedarloom/orchestration/guard-hook"));
  return {
    command: process.execPath,
    args: [hook, JSON.stringify(policy)],
    files: [packageRoot("@cedarloom/orchestration/guard-hook"), packageRoot("@cedarloom/contracts")],
  };
};
