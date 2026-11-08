import type { AutomationLevel, WorkflowDefinition } from "@cedarloom/contracts";
import { describe, frontmatter, inert, manifestOf, type PackageFile, titleOf, USER_ONLY } from "./files.ts";
import type { Source, StageScript, Step } from "./runner.ts";
import { nextsOf, PRECHECK_SCRIPT, precheckOf, type Stage, scriptOf } from "./stages.ts";

const WHEN: Record<string, string> = {
  start: "started",
  done: "succeeded",
  failed: "failed",
  true: "was true",
  false: "was false",
  approved: "was approved",
  rejected: "was rejected",
};

const when = (step: Step): string =>
  step.run
    .map((key) => {
      const [node = "", handle = ""] = key.split(".");
      return `\`${node}\` ${WHEN[handle] ?? handle}`;
    })
    .join(" and ");

const from = (source: Source): string => {
  if ("input" in source) return `the input \`${source.input}\``;
  const [node = "", handle = ""] = source.output.split(".");
  return handle === "exitCode" ? `the exit code of step \`${node}\`` : `the output of step \`${node}\``;
};

// The steps in an order that runs each after the steps it waits on.
const ordered = (steps: Step[]): Step[] => {
  const placed: Step[] = [];
  for (let next = steps; next.length > 0; ) {
    const ready = next.filter((step) => step.after.every((id) => placed.some((each) => each.id === id)));
    if (ready.length === 0) break;
    placed.push(...ready);
    next = next.filter((step) => !ready.includes(step));
  }
  return placed;
};

// Single quotes, as the runner writes them: no character of the plugin's folder is read by the shell.
const run = (script: string | undefined): string => `\`sh '<root>/${script ?? ""}'\``;

const again = (retries: number | undefined): string =>
  retries === undefined ? "" : ` If it fails, run it again, ${retries} times at most.`;

// What a failure no step takes does: under fail_fast the stage stops, else the steps that do not wait on it go on.
const onFailure = (step: Step): string => {
  if (step.handled === true) return "";
  return step.failFast === true
    ? " If it still fails, stop the stage."
    : " If it still fails, go on with the steps that do not wait on it.";
};

// An agent step in prose: its task, its context, how it reviews, its retries and its checks.
const agentLine = (head: string, step: Step, stage: StageScript, fresh: boolean): string => {
  const context = step.context === undefined ? "" : `, with ${from(step.context)} as its context`;
  // A fresh context (coordinator, 247 Q3 b): Codex's own sub-agent with no earlier turns, no agent file of ours.
  const reviewer = fresh
    ? ' Run it in a fresh sub-agent: call spawn_agent with fork_turns "none" and this task and its context, and use its answer.'
    : "";
  const checks = (step.checks ?? []).map((id) => {
    const check = stage.steps.find((each) => each.id === id);
    return `\n  Then its check \`${id}\`: run ${run(check?.script)}.${again(check?.retries)} While it still exits non-zero, fix the work with what it printed and check again, three rounds at most, else \`${step.id}\` failed.`;
  });
  const task = inert(step.prompt ?? "")
    .split("\n")
    .join("\n  > ");
  return `${head} do this task${context}.${reviewer}${again(step.retries)}${onFailure(step)}\n\n  > ${task}\n${checks.join("")}`;
};

// A gate the level keeps, in prose: the stop, its message and the commands that go on.
const stopLine = (head: string, step: Step): string => {
  const next = (step.next ?? []).map((each) => {
    const inputs = each.inputs.map((name) => `\`${name}\``).join(", ") || "none";
    return `\`${each.command}\` with the inputs ${inputs} as given`;
  });
  const message = JSON.stringify(step.message ?? "");
  const goOn = next.length === 0 ? "; the workflow ends there" : ` and the commands that go on: ${next.join("; ")}`;
  return `${head} stop the stage. Show the user ${message}${goOn}. Never start a next stage yourself.`;
};

// What Codex does for one step, in prose; nothing for the start.
const line = (step: Step, stage: StageScript, fresh: boolean): string | null => {
  const head = `- \`${step.id}\`, once ${when(step)}:`;
  if (step.kind === "agent") return agentLine(head, step, stage, fresh);
  if (step.kind === "stop") return stopLine(head, step);
  if (step.kind === "command") {
    return `${head} run ${run(step.script)} exactly as written; exit code 0 succeeds.${again(step.retries)}${onFailure(step)}`;
  }
  if (step.kind === "check")
    return `${head} the check of that step, run with it above; it succeeded when its step did.`;
  if (step.kind === "condition")
    return `${head} ${step.value === undefined ? "" : from(step.value)} is true or false; anything else fails it.`;
  if (step.kind === "pass") return `${head} this level passes this gate: it counts as approved; go on.`;
  return step.kind === "join" ? `${head} nothing to do; go on.` : null;
};

/** A stage as a skill Codex follows: the steps in order, each with its condition. */
const stageSkill = (workflow: WorkflowDefinition, stage: Stage, script: StageScript): PackageFile[] => {
  const precheck =
    stage.from === null && precheckOf(workflow).length > 0
      ? `First run ${run(PRECHECK_SCRIPT)} from the project folder; if it exits non-zero, stop: the workflow has nothing to do.\n\n`
      : "";
  const fresh = (id: string): boolean => workflow.nodes.find((node) => node.id === id)?.with?.["fresh"] === true;
  const steps = ordered(script.steps).flatMap((step) => line(step, script, fresh(step.id)) ?? []);
  const defaults = Object.entries(script.defaults).map(([name, value]) => `\`${name}\` = ${JSON.stringify(value)}`);
  const required = script.required.map((name) => `\`${name}\``);
  const given = `The inputs are the JSON object the user gave with this command${defaults.length === 0 ? "" : `; an input left out takes its default: ${defaults.join(", ")}`}.`;
  const inputs =
    required.length === 0
      ? given
      : `${given} This stage needs ${required.join(", ")}: if one is missing, stop and ask for it.`;
  const outputs = Object.entries(script.outputs).map(([name, source]) => `\`${name}\`: ${from(source)}`);
  const report = `At the end, report the steps that succeeded, failed or were skipped${outputs.length === 0 ? "" : `, and the workflow's outputs in full (${outputs.join("; ")})`}.`;
  // The user starting this stage is the gate's answer, which the steps below wait on.
  const answer =
    stage.from === null
      ? ""
      : ` Starting this stage is the answer at gate \`${stage.from.node}\`: it was ${stage.from.handle}.`;
  const body = `${precheck}Run the stage \`${stage.name}\` of the workflow \`${titleOf(workflow)}\`.${answer} Do the steps below, in this order, each only once the steps it names ended as it says; skip it otherwise. \`<root>\` is this plugin's folder, two levels above the folder of this skill; run every command from the project folder. ${inputs}\n\n${steps.join("\n")}\n\n${report}\n`;
  const description = describe(
    `Runs the stage ${stage.name} of the workflow ${titleOf(workflow)} in Codex, up to its next gate.`,
  );
  return [
    { path: `codex/${stage.name}/SKILL.md`, content: `${frontmatter({ name: stage.name, description })}${body}` },
    { path: `codex/${stage.name}/agents/openai.yaml`, content: USER_ONLY },
  ];
};

/** Codex's part of the package (owner, Q2 a): its manifest and a skill per stage; no Codex hooks, agents or rules. */
export const codexFiles = (
  workflow: WorkflowDefinition,
  stages: Stage[],
  { plugin, level }: { plugin: string; level: AutomationLevel },
): PackageFile[] => {
  const nextOf = nextsOf(workflow, stages, (stage) => `$${plugin}:${stage.name}`);
  return [
    { path: ".codex-plugin/plugin.json", content: manifestOf(workflow, { plugin, level, folder: "./codex/" }) },
    ...stages.flatMap((stage) => stageSkill(workflow, stage, scriptOf(workflow, stage, { plugin, level, nextOf }))),
  ];
};
