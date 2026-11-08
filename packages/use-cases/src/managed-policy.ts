import type { Finding } from "@cedarloom/contracts";
import {
  cachedPolicyProblems,
  type ManagedPlaces,
  type ManagedProblem,
  managedPlaces,
  policyProblems,
  type Run,
} from "@cedarloom/orchestration";
import { claudeHome } from "./profiles.ts";

// What switches the guard's PreToolUse hook or the sandbox off in the user's own sessions; the guard is a plugin hook, so
// strictPluginOnlyCustomization leaves it on.
const OFF = new Set(["disableAllHooks", "allowManagedHooksOnly", "sandbox.enabled", "sandbox.filesystem.disabled"]);

const findingOf = (problem: ManagedProblem): Finding => {
  if (problem.kind === "unreadable") {
    return { code: "managed.unreadable", params: { path: problem.path, error: problem.error } };
  }
  // A policy helper's output replaces every managed source, and what it computes cannot be read beforehand.
  if (problem.key === "policyHelper")
    return { code: "managed.unreadable", params: { path: problem.path, error: "policyHelper" } };
  return { code: "managed.guard-off", params: { path: problem.path, key: problem.key } };
};

/**
 * The doctor's warnings about this machine's managed Claude Code policy: every place Claude Code reads one from (the
 * configuration profile's plists, the policy registry values, the files, and the server-managed copy cached in the
 * user's Claude Code home) that switches hooks or the sandbox off, or that cannot be read.
 */
export const managedPolicyDoctor = (
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
  { places = managedPlaces(platform, env), run }: { places?: ManagedPlaces; run?: Run } = {},
): Finding[] =>
  [...policyProblems(places, run), ...cachedPolicyProblems(claudeHome(env))]
    .filter((problem) => problem.kind === "unreadable" || problem.key === "policyHelper" || OFF.has(problem.key))
    .map(findingOf);
