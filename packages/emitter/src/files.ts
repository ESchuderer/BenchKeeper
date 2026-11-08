import { shown, type WorkflowDefinition } from "@cedarloom/contracts";
import { skillOf, textIn } from "./stages.ts";

/** A file of a package, by its path inside the plugin folder. */
export type PackageFile = { path: string; content: string };

type Node = WorkflowDefinition["nodes"][number];

/** YAML front matter: each string as a JSON string, which YAML reads as a double-quoted one. */
export const frontmatter = (fields: Record<string, string | boolean>): string =>
  `---\n${Object.entries(fields)
    .map(([key, value]) => `${key}: ${typeof value === "string" ? JSON.stringify(value) : String(value)}`)
    .join("\n")}\n---\n\n`;

/** What a skill or agent says it is: plain, at most 1,024 characters (https://agentskills.io/specification). */
export const describe = (text: string): string => shown(text, 1024);

/**
 * Workflow text in skill content: Claude Code runs a `!` before a backtick, or a fence opened with `!`, as a command when
 * the skill loads, unseen by the guard (https://code.claude.com/docs/en/skills#inject-dynamic-context); a space defuses it.
 */
const inert = (text: string): string => text.replaceAll("!`", "! `").replaceAll("```!", "``` !");

/**
 * How the package names its workflow to agents: by id, as the import review shows it; the free-text name never reaches
 * a model, as no review shows it.
 */
export const titleOf = (workflow: WorkflowDefinition): string => workflow.metadata.id;

const quoted = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`;

/**
 * The skill folder of a step, which Claude Code and Codex read alike (spec fields only): an agent step's task, or a
 * command step's script.
 */
export const stepFiles = (workflow: WorkflowDefinition, node: Node): PackageFile[] => {
  const name = skillOf(node);
  const config = node.with ?? {};
  const head = `Step ${node.id} of the workflow ${titleOf(workflow)}`;
  if (node.type === "agent.run") {
    const task = inert(textIn(node, "task"));
    const skill = `${frontmatter({ name, description: describe(`${head}: ${task.split("\n")[0] ?? ""}`) })}${task}\n`;
    return [{ path: `steps/${name}/SKILL.md`, content: skill }];
  }
  // "./" first: cd reads no option from it (-P), and CDPATH takes no part.
  const cwd = typeof config["cwd"] === "string" ? `cd ${quoted(`./${config["cwd"]}`)} || exit 1\n` : "";
  const skill = `${frontmatter({ name, description: describe(`${head}: runs its command`) })}Run the script \`scripts/run.sh\` of this skill's folder with \`sh\`, from the project folder, exactly once. Report its exit code and the last 100 lines of its output.\n`;
  return [
    { path: `steps/${name}/SKILL.md`, content: skill },
    { path: `steps/${name}/scripts/run.sh`, content: `#!/bin/sh\n${cwd}${textIn(node, "command")}\n` },
  ];
};
