import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GUARD_SCHEMA_VERSION, type GuardPolicy } from "@cedarloom/contracts";
import { githubRepo, type Remotes } from "./guard.ts";

/** The fetch and push URLs of a folder's remotes as git reads them, insteadOf rewrites applied; null when unreadable. */
export const gitRemotes: Remotes = (folder) => {
  try {
    const listed = execFileSync("git", ["-c", "core.fsmonitor=false", "-C", folder, "remote", "-v"], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    const remotes = new Map<string, string[]>();
    for (const [, name = "", url = ""] of listed.matchAll(/^(\S+)\t(\S+) \((?:fetch|push)\)$/gm)) {
      remotes.set(name, [...new Set([...(remotes.get(name) ?? []), url])]);
    }
    return remotes;
  } catch {
    return null;
  }
};

/**
 * A worker's guard policy: the GitHub repositories of its project's remotes and the hub, the hub from this machine's
 * binding; no memory repository yet. A project without GitHub remotes leaves the worker the hub alone.
 */
export const workerPolicy = (project: string, hub: string | null): GuardPolicy => {
  const urls = [...(gitRemotes(project)?.values() ?? [])].flat();
  const named = [...urls.map(githubRepo), hub].filter((repo) => repo !== null);
  return { schemaVersion: GUARD_SCHEMA_VERSION, repositories: [...new Set(named)], hub, memory: null };
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
