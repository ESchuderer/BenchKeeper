import { type AutomationLevel, type Result, severityOf, type WorkflowDefinition } from "@cedarloom/contracts";
import { validateWorkflow } from "@cedarloom/engine/validate";
import { claudeFiles, type Hooks, workflowOf } from "./claude.ts";
import { codexFiles } from "./codex.ts";
import { type PackageFile, stepFiles } from "./files.ts";
import { nameOf, precheckOf, skillOf, stagesOf } from "./stages.ts";

export type { Hooks } from "./claude.ts";
export type { PackageFile } from "./files.ts";
export { type Source, type StageScript, type Step, stageScript } from "./runner.ts";
/** The plugin a workflow builds into, named from its id. */
export { nameOf as pluginOf } from "./stages.ts";

// Plugin names Claude Code keeps for Anthropic's own (https://code.claude.com/docs/en/plugins/manifest-reference#name).
const RESERVED = [
  /^(?:claude|anthropics?|cc-plugin)(?:-|$)/,
  /(?:^|-)official-(?:claude|anthropic)/,
  /(?:claude|anthropic)-official/,
];

/**
 * Builds a workflow at an automation level, with the hooks Claude Code runs it under, into the files of one plugin folder,
 * sorted by path, or says why it builds none: a validator error, a name Claude Code keeps, a stage the level's gates
 * cannot split, or a name taken twice.
 */
export const buildPackage = (
  workflow: WorkflowDefinition,
  level: AutomationLevel,
  hooks: Hooks,
): Result<PackageFile[]> => {
  const error = validateWorkflow(workflow).find((finding) => severityOf(finding) === "error");
  if (error !== undefined) return { ok: false, finding: error };
  const plugin = nameOf(workflow.metadata.id);
  if (RESERVED.some((pattern) => pattern.test(plugin)))
    return { ok: false, finding: { code: "package.reserved-name", params: { name: plugin } } };
  const stages = stagesOf(workflow, level);
  if (!stages.ok) return stages;
  const steps = stages.value
    .flatMap((stage) => stage.nodes)
    .filter((node) => node.type === "agent.run" || node.type === "command.run");
  // Stage skills, stage scripts and steps share the plugin's namespace of commands; two gates can fold to one name.
  const names = [
    ...stages.value.flatMap((stage) =>
      [stage.name, workflowOf(stage)].map((name) => ({ name, node: stage.from?.node ?? "" })),
    ),
    ...steps.map((node) => ({ name: skillOf(node), node: node.id })),
  ];
  const taken = names.find((each, index) => names.findIndex((other) => other.name === each.name) !== index);
  if (taken !== undefined) return { ok: false, finding: { code: "package.name-taken", params: taken } };
  const files = [
    ...claudeFiles(workflow, stages.value, { plugin, level, hooks }),
    ...codexFiles(workflow, stages.value, { plugin, level }),
    ...steps.flatMap((node) => stepFiles(workflow, node)),
    ...precheckOf(workflow),
  ];
  return { ok: true, value: files.toSorted((a, b) => (a.path < b.path ? -1 : 1)) };
};
