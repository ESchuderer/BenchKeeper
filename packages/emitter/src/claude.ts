import {
  type AutomationLevel,
  GUARD_SCHEMA_VERSION,
  type GuardPolicy,
  heldRepo,
  type WorkflowDefinition,
} from "@cedarloom/contracts";
import { stageScript } from "./runner.ts";
import { inputsOf, nextsOf, PRECHECK_SCRIPT, precheckOf, type Stage, scriptOf, skillOf } from "./stages.ts";
import { describe, frontmatter, manifestOf, type PackageFile, titleOf } from "./files.ts";

type Node = WorkflowDefinition["nodes"][number];

/** The workflow script that runs a stage: its name, without the plugin's. */
export const workflowOf = (stage: Stage): string => `run-${stage.name}`;

// The precheck runs from its own script: no workflow text reaches the skill's body, where Claude Code would
// run any !`…` in it, also inside a fence, unseen by the guard. Its result is spelled out, as the model sees only output.
const PRECHECK = `!\`sh "\${CLAUDE_PLUGIN_ROOT}/${PRECHECK_SCRIPT}" && echo "precheck passed" || echo "precheck failed"\``;

// The args: the plugin's folder, where the steps' scripts are, and the inputs the stage reads, by name and type only.
const argsText = (workflow: WorkflowDefinition, stage: Stage): string => {
  const lines = inputsOf(workflow, stage).map((name) => {
    const input = workflow.inputs?.[name];
    return `- \`${name}\` (${input?.type ?? "json"}${input?.required === true ? ", required" : ""})`;
  });
  // Always the arguments as given: a stage that reads no input passes on those a later stage reads.
  const reads = lines.length === 0 ? "This stage reads none of them." : `This stage reads:\n${lines.join("\n")}`;
  return `Pass as its args a JSON object: \`root\` the text \`\${CLAUDE_PLUGIN_ROOT}\`, and \`inputs\` the JSON object given in the arguments of this command ($ARGUMENTS), or {} when there are none; an input left out takes its default. ${reads}`;
};

/** The command that starts a stage: a skill only the user runs, as the stage after a gate is the user's to start. */
const stageSkill = (workflow: WorkflowDefinition, stage: Stage, plugin: string): PackageFile => {
  const check =
    stage.from !== null || precheckOf(workflow).length === 0
      ? ""
      : `The workflow's precheck: ${PRECHECK}\nIf it failed, stop here and say that the workflow has nothing to do.\n\n`;
  const what =
    stage.from === null ? "Starts" : `Goes on after the gate ${stage.from.node} was ${stage.from.handle}: runs`;
  const description = describe(`${what} the workflow ${titleOf(workflow)} up to its next gate.`);
  const body = `${check}Start the workflow \`${plugin}:${workflowOf(stage)}\` with the Workflow tool and wait for it. ${argsText(workflow, stage)}\n\nWhen it returns, report the steps that ran, failed or were skipped, and the workflow's outputs in full. For each gate it stopped at, show its message and the commands that go on, and leave them to the user: never start the next stage yourself.\n`;
  const fields = { name: stage.name, description, "disable-model-invocation": true };
  return { path: `claude/${stage.name}/SKILL.md`, content: `${frontmatter(fields)}${body}` };
};

/** The subagent of a step that sets tools or a fresh context: Read, Grep and Glob unless it names its tools. */
const agentFile = (workflow: WorkflowDefinition, node: Node): PackageFile[] => {
  const config = node.with ?? {};
  const fresh = config["fresh"] === true;
  if (!fresh && config["tools"] === undefined) return [];
  const tools = Array.isArray(config["tools"]) ? config["tools"].map(String) : ["Read", "Grep", "Glob"];
  const name = skillOf(node);
  const description = describe(`Runs step ${node.id} of the workflow ${titleOf(workflow)}.`);
  const reviewer = fresh ? " You did not do the work you look at: judge it as someone who meets it fresh." : "";
  const body = `You run step ${node.id} of the workflow ${titleOf(workflow)}, as your prompt says.${reviewer}\n`;
  return [
    { path: `agents/${name}.md`, content: `${frontmatter({ name, description, tools: tools.join(", ") })}${body}` },
  ];
};

/** The workflow script of a stage. */
const workflowFile = (
  workflow: WorkflowDefinition,
  stage: Stage,
  context: Parameters<typeof scriptOf>[2],
): PackageFile => {
  const meta = { name: workflowOf(stage), description: `${titleOf(workflow)}: the stage ${stage.name}` };
  return { path: `workflows/${workflowOf(stage)}.js`, content: stageScript(meta, scriptOf(workflow, stage, context)) };
};

/**
 * What the package's hooks run: the guard's and the exit hook's built files (`hooks/guard.mjs`, `hooks/exits.mjs` of
 * the CLI package), the Node.js that runs them, and this machine's hub and memory repositories, which the guard lets a
 * workflow's agent reach besides the working folder's origin (one it cannot hold counts as none).
 */
export type Hooks = {
  readonly guard: string;
  readonly exits: string;
  /** An absolute path: the hooks run outside the sandbox, where a relative PATH entry lets a session's files stand in. */
  readonly node: string;
  readonly hub: string | null;
  readonly memory: string | null;
};

const HOOKS = "hooks/claude-code.json";

// Node.js runs a hook's file, its arguments passed as they are (no shell); Claude Code fills in the plugin's folder.
const hookOf = (node: string, file: string, ...args: string[]): Record<string, unknown> => ({
  type: "command",
  command: node,
  args: [`\${CLAUDE_PLUGIN_ROOT}/hooks/${file}`, ...args],
});

/**
 * The hooks file: the guard before every shell call and agent, its merges by level (Auto: an agent of a workflow script,
 * owner 2026-11-08), and the exit hook, which keeps each step script's status and refuses a report that differs. A crash
 * or timeout of the guard or of `verify` refuses (`onFailure`, Claude Code 2.1.295 or later); Codex reads no such file.
 */
const hooksFile = (plugin: string, level: AutomationLevel, { node, hub, memory }: Hooks): PackageFile => {
  const policy: GuardPolicy = {
    schemaVersion: GUARD_SCHEMA_VERSION,
    hub: heldRepo(hub),
    memory: heldRepo(memory),
    merge: level === "auto" ? "workflow" : "refuse",
    plugin,
  };
  const record = [{ matcher: "Bash", hooks: [hookOf(node, "exits.mjs", "record")] }];
  const hooks = {
    PreToolUse: [
      {
        matcher: "Bash|Monitor|PowerShell|Agent",
        hooks: [{ ...hookOf(node, "guard.mjs", JSON.stringify(policy)), onFailure: "block" }],
      },
      { matcher: "StructuredOutput", hooks: [{ ...hookOf(node, "exits.mjs", "verify"), onFailure: "block" }] },
    ],
    PostToolUse: record,
    PostToolUseFailure: record,
  };
  return { path: HOOKS, content: `${JSON.stringify({ hooks }, null, 2)}\n` };
};

/** Claude Code's part of the package: its manifest and hooks, a skill and a workflow script per stage, the subagents. */
export const claudeFiles = (
  workflow: WorkflowDefinition,
  stages: Stage[],
  { plugin, level, hooks }: { plugin: string; level: AutomationLevel; hooks: Hooks },
): PackageFile[] => {
  const nextOf = nextsOf(workflow, stages, (stage) => `/${plugin}:${stage.name}`);
  const manifest = manifestOf(workflow, { plugin, level, folder: "./claude/", hooks: `./${HOOKS}` });
  return [
    { path: ".claude-plugin/plugin.json", content: manifest },
    hooksFile(plugin, level, hooks),
    { path: "hooks/guard.mjs", content: hooks.guard },
    { path: "hooks/exits.mjs", content: hooks.exits },
    ...stages.flatMap((stage) => [
      stageSkill(workflow, stage, plugin),
      workflowFile(workflow, stage, { plugin, level, nextOf }),
    ]),
    ...stages
      .flatMap((stage) => stage.nodes.filter((node) => node.type === "agent.run"))
      .flatMap((node) => agentFile(workflow, node)),
  ];
};
