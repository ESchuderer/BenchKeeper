import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Finding, LaunchPlugins, Result } from "@cedarloom/contracts";
import type { FetchOptions, Source, Tree } from "@cedarloom/git";
import { writeTree } from "./staging.ts";

/**
 * Where the workers' plugin comes from: the marketplace's `plugins` folder at the commit this release pins, which a pull
 * request bumps. BenchKeeper's marketplace until the CedarLoom launch; it has no `plugins/workflow` yet, so workers start
 * without a plugin until a pinned commit has one.
 */
export const WORKFLOW_PLUGIN = {
  url: "https://github.com/ESchuderer/BenchKeeper.git",
  commit: "4faf1c591ac8c143c9c30d6e03ffbc378132dd34",
  name: "workflow",
} as const;

/** Reads a folder of a repository at a commit: the git package's `fetchTree`. */
export type FetchTree = (source: Source, options: FetchOptions) => Promise<Result<Tree>>;

// Places the checkout; one another launch placed first stays, and a write that fails leaves none: no plugin.
const place = (parent: string, checkout: string, tree: Tree): void => {
  try {
    writeTree(parent, checkout, tree);
  } catch {
    // The checkout's presence says which.
  }
};

/**
 * The workflow plugin's folder in CedarLoom's own checkout of the marketplace's plugins at the pinned commit, fetched
 * once into `<state>/plugins/<commit>`. Null when that commit has none, which stays known, or when the fetch failed or
 * gave another commit.
 */
export const workflowPlugin = async (state: string, fetch: FetchTree): Promise<string | null> => {
  const { url, commit, name } = WORKFLOW_PLUGIN;
  const parent = join(state, "plugins");
  const checkout = join(parent, commit);
  if (!existsSync(checkout)) {
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    // shortcut: a failed fetch is tried again at every launch, up to 60 s each; remember failures if that slows launches.
    const tree = await fetch({ url, ref: commit, path: "plugins" }, { parent, timeoutMs: 60_000 });
    if (!tree.ok || tree.value.commit !== commit) return null;
    place(parent, checkout, tree.value);
  }
  const plugin = join(checkout, name);
  // --add-dir would also load a .claude folder of the plugin, settings and skills of its own: refused.
  return existsSync(plugin) && !existsSync(join(plugin, ".claude")) ? plugin : null;
};

/**
 * What the latest launch's init line shows about its plugins: none passed, because the pinned commit has no workflow
 * plugin yet (or it could not be fetched), or a plugin passed that did not load with its skills, with its load errors.
 */
export const pluginProblems = (plugins: LaunchPlugins | null): Finding[] => {
  if (plugins === null) return [];
  const { expected, loaded, skills, errors } = plugins;
  if (expected.length === 0) {
    return [{ code: "doctor.plugin-none", params: { plugin: WORKFLOW_PLUGIN.name, commit: WORKFLOW_PLUGIN.commit } }];
  }
  const missing = expected.filter(
    (name) => !loaded.includes(name) || !skills.some((skill) => skill.startsWith(`${name}:`)),
  );
  return missing.map((plugin) => ({ code: "doctor.plugin-not-loaded", params: { plugin, errors: errors.join("; ") } }));
};
