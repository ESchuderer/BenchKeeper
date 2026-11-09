import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type AutomationLevel, WORKFLOW_MARKETPLACE } from "@cedarloom/contracts";
import * as useCases from "@cedarloom/use-cases";
import { change, machineOf, refused } from "./commands.ts";
import { folderArgument } from "./messages.ts";
import { type Context, EXIT, emit, fail, report } from "./output.ts";

// The bundles every package's hooks run, which the CLI package ships in its hooks folder; null when one is missing.
const bundlesIn = (folder: string): { guard: string; exits: string } | null => {
  try {
    const read = (name: string): string => readFileSync(join(folder, name), "utf8");
    return { guard: read("guard.mjs"), exits: read("exits.mjs") };
  } catch {
    return null;
  }
};

// Codex loads the same folder from its own copy (`codex plugin add`), which CedarLoom shows and never writes.
const codexAdd = (plugin: string, marketplace: string): string =>
  `\n  Codex: codex plugin marketplace add ${folderArgument(marketplace)} (once), then codex plugin add ${plugin}@${WORKFLOW_MARKETPLACE}; Codex runs its own copy, so add it again after every install, a rebuild at another level too.`;

// What the package changes beyond its stages: the hooks guard every session, and need the Node.js they were given.
const hooksNote = (node: string): string =>
  `\n  Its hooks run in every Claude Code session while the package is on: there the guard refuses merges, approvals, force pushes, gh's configuration and the owner's writes; a workflow's agents also meet its repository limit and its refusal of what it cannot read, such as a subshell (cd x && make) or a group { a; b; }. They run with ${node}; should that path go, as a versioned Homebrew one does on brew upgrade, Claude Code refuses every shell call and agent in those sessions until you install again, which cedarloom doctor reports.`;

type Install = { level?: AutomationLevel; allow?: string; yes?: true };

/**
 * Shows installing the stored workflow `id` as a package, or with `--allow <plugin> --yes` installs it as one run, which
 * `runs undo` takes back.
 */
export const workflowsInstall = (ctx: Context, id: string, { level, allow, yes }: Install): number => {
  const bundles = bundlesIn(ctx.hooks);
  if (bundles === null) {
    return fail(ctx, "plan", [{ code: "package.hooks-missing", params: { path: ctx.hooks } }], EXIT.refused);
  }
  const node = useCases.stableNode(process.execPath, ctx.io.env);
  const options = { level, allow: allow === undefined ? [] : [allow], bundles, node };
  const folders = { config: ctx.config, state: ctx.state, home: machineOf(ctx).home };
  const planned = useCases.planPackageInstall(folders, id, options);
  if (!planned.ok) return refused(ctx, "plan", planned.finding);
  const { plan, findings, plugin, marketplace } = planned.value;
  // The approval by name is the plugin's: --yes alone never installs hooks that run in every session.
  const held = findings.some(({ code }) => code === "package.approval-needed");
  if (yes === true && held) return fail(ctx, "plan", findings, EXIT.refused);
  const data = { plugin, level: planned.value.level, marketplace, node };
  if (plan === null) {
    emit(ctx, "plan", { planHash: null, plan: null, findings, ...data }, `${plugin} is installed as built now.`);
    report(ctx, findings);
    return EXIT.ok;
  }
  return change(ctx, plan, { note: `${hooksNote(node)}${codexAdd(plugin, marketplace)}`, data, findings, held }, yes);
};

/** Shows removing the installed package of `id` with what its hooks kept, or with `--yes` removes it as one run. */
export const workflowsUninstall = (ctx: Context, id: string, { yes }: { yes?: true }): number => {
  const planned = useCases.planPackageUninstall({ state: ctx.state, home: machineOf(ctx).home }, id);
  if (!planned.ok) return refused(ctx, "plan", planned.finding);
  const { plan, plugin, marketplace } = planned.value;
  const note = `\n  Codex: codex plugin remove ${plugin}@${WORKFLOW_MARKETPLACE}`;
  if (plan === null) return refused(ctx, "plan", { code: "package.not-installed", params: { id } });
  return change(ctx, plan, { note, data: { plugin, marketplace }, findings: [] }, yes);
};
