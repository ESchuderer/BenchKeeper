import type { AutomationLevel, WorkflowDefinition } from "@cedarloom/contracts";
import { RUNNER } from "./runner.ts";
import { type Stage, scriptOf, skillOf } from "./stages.ts";
import { describe, frontmatter, type PackageFile, titleOf } from "./files.ts";

type Node = WorkflowDefinition["nodes"][number];

/** The workflow script that runs a stage: its name, without the plugin's. */
export const workflowOf = (stage: Stage): string => `run-${stage.name}`;

// The precheck runs from a script beside the skill: no workflow text reaches the skill's body, where Claude Code would
// run any !`…` in it, also inside a fence, unseen by the guard. Its result is spelled out, as the model sees only output.
const PRECHECK =
  '!`sh "${CLAUDE_PLUGIN_ROOT}/claude/start/scripts/precheck.sh" && echo "precheck passed" || echo "precheck failed"`';

// The inputs by name and type only: descriptions and defaults, which no review shows, stay out of what a model reads.
const inputsText = (workflow: WorkflowDefinition): string => {
  const inputs = Object.entries(workflow.inputs ?? {});
  if (inputs.length === 0) return "The workflow takes no inputs: pass no args.";
  const lines = inputs.map(
    ([name, input]) => `- \`${name}\` (${input.type}${input.required === true ? ", required" : ""})`,
  );
  return `Pass as its args a JSON object of the workflow's inputs, from the arguments of this command ($ARGUMENTS); an input left out takes its default:\n${lines.join("\n")}`;
};

/** The command that starts a stage: a skill only the user runs, as the stage after a gate is the user's to start. */
const stageSkill = (workflow: WorkflowDefinition, stage: Stage, plugin: string): PackageFile[] => {
  const given = workflow.nodes.find((node) => node.type === "trigger.manual")?.with?.["precheck"];
  const precheck = stage.from === null && typeof given === "string" ? given : null;
  const check =
    precheck === null
      ? ""
      : `The workflow's precheck: ${PRECHECK}\nIf it failed, stop here and say that the workflow has nothing to do.\n\n`;
  const what =
    stage.from === null ? "Starts" : `Goes on after the gate ${stage.from.node} was ${stage.from.handle}: runs`;
  const description = describe(`${what} the workflow ${titleOf(workflow)} up to its next gate.`);
  const body = `${check}Start the workflow \`${plugin}:${workflowOf(stage)}\` with the Workflow tool and wait for it. ${inputsText(workflow)}\n\nWhen it returns, report the steps that ran, failed or were skipped. For each gate it stopped at, show its message and the commands that go on.\n`;
  const fields = { name: stage.name, description, "disable-model-invocation": true };
  const skill = { path: `claude/${stage.name}/SKILL.md`, content: `${frontmatter(fields)}${body}` };
  const script = { path: "claude/start/scripts/precheck.sh", content: `#!/bin/sh\n${precheck ?? ""}\n` };
  return precheck === null ? [skill] : [skill, script];
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

/** The script of a stage: the meta block, the stage as data, then the runner's functions. */
const workflowFile = (
  workflow: WorkflowDefinition,
  stage: Stage,
  context: Parameters<typeof scriptOf>[2],
): PackageFile => {
  const meta = { name: workflowOf(stage), description: `${titleOf(workflow)}: the stage ${stage.name}` };
  const functions = RUNNER.map((fn) => `const ${fn.name} = ${fn.toString()};`).join("\n\n");
  const content = `export const meta = ${JSON.stringify(meta, null, 2)};\n\nconst STAGE = ${JSON.stringify(scriptOf(workflow, stage, context), null, 2)};\n\n${functions}\n\nreturn await runStage(STAGE, { agent, parallel, args });\n`;
  return { path: `workflows/${workflowOf(stage)}.js`, content };
};

/** Claude Code's part of the package: its manifest, a skill and a workflow script per stage, and the step subagents. */
export const claudeFiles = (
  workflow: WorkflowDefinition,
  stages: Stage[],
  { plugin, level }: { plugin: string; level: AutomationLevel },
): PackageFile[] => {
  const nextOf = (gate: string): string[] =>
    stages.filter((stage) => stage.from?.node === gate).map((stage) => `/${plugin}:${stage.name}`);
  const manifest = {
    name: plugin,
    version: workflow.metadata.version,
    description: describe(`The CedarLoom workflow ${titleOf(workflow)}, at the automation level ${level}.`),
    skills: ["./steps/", "./claude/"],
  };
  return [
    { path: ".claude-plugin/plugin.json", content: `${JSON.stringify(manifest, null, 2)}\n` },
    ...stages.flatMap((stage) => [
      ...stageSkill(workflow, stage, plugin),
      workflowFile(workflow, stage, { plugin, level, nextOf }),
    ]),
    ...stages
      .flatMap((stage) => stage.nodes.filter((node) => node.type === "agent.run"))
      .flatMap((node) => agentFile(workflow, node)),
  ];
};
