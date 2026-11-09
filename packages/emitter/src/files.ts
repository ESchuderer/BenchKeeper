import { type AutomationLevel, shown, type WorkflowDefinition } from "@cedarloom/contracts";
import { skillOf, textIn } from "./stages.ts";

/** Codex's policy file of a skill no model loads on its own: off the model's list, the user's still (Codex 0.166.0, `codex-rs/ext/skills/src/provider/host.rs` L166-168). */
export const USER_ONLY = "policy:\n  allow_implicit_invocation: false\n";

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
export const inert = (text: string): string => text.replaceAll("!`", "! `").replaceAll("```!", "``` !");

/**
 * How the package names its workflow to agents: by id, as the import review shows it; the free-text name never reaches
 * a model, as no review shows it.
 */
export const titleOf = (workflow: WorkflowDefinition): string => workflow.metadata.id;

const OWN = "disable-model-invocation";

const quoted = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`;

/**
 * The skill folder of a step, which Claude Code and Codex read alike: an agent step's task, or a command step's script.
 * No model loads a step on its own, outside its stage and gates (coordinator, 2026-11-08): Claude Code reads
 * `disable-model-invocation`, Codex its own policy file.
 */
export const stepFiles = (workflow: WorkflowDefinition, node: Node): PackageFile[] => {
  const name = skillOf(node);
  const config = node.with ?? {};
  const head = `Step ${node.id} of the workflow ${titleOf(workflow)}`;
  if (node.type === "agent.run") {
    const task = inert(textIn(node, "task"));
    const fields = { name, description: describe(`${head}: ${task.split("\n")[0] ?? ""}`), [OWN]: true };
    const skill = `${frontmatter(fields)}${task}\n`;
    return [
      { path: `steps/${name}/SKILL.md`, content: skill },
      { path: `steps/${name}/agents/openai.yaml`, content: USER_ONLY },
    ];
  }
  // "./" first: cd reads no option from it (-P), and CDPATH takes no part.
  const cwd = typeof config["cwd"] === "string" ? `cd ${quoted(`./${config["cwd"]}`)} || exit 1\n` : "";
  // The script's own status as its last line, which Claude Code's exit hook reads whatever the agent adds to the call. The
  // output before it is the command's last 6,000 bytes, printed when it ends, which a hook reads whole (Claude Code 2.1.316
  // cut a failed call's to about 10,000 characters, observed). The status passes the pipe in a file, as sh has no pipefail.
  const run = `(\n(\n${cwd}${textIn(node, "command")}\n)\necho "$?" > "$st"\n) 2>&1 | tail -c 6000\nstatus=$(cat "$st")\nrm -f "$st"\n`;
  const script = `#!/bin/sh\nst=$(mktemp) || { echo "cedarloom-exit 1"; exit 1; }\n${run}printf '\\ncedarloom-exit %s\\n' "\${status:-1}"\nexit "\${status:-1}"\n`;
  const skill = `${frontmatter({ name, description: describe(`${head}: runs its command`), [OWN]: true })}Run the script \`scripts/run.sh\` of this skill's folder with \`sh\`, from the project folder, exactly once. Report its exit code and the last 100 lines of its output.\n`;
  return [
    { path: `steps/${name}/SKILL.md`, content: skill },
    { path: `steps/${name}/agents/openai.yaml`, content: USER_ONLY },
    { path: `steps/${name}/scripts/run.sh`, content: script },
  ];
};

// How a manifest names the workflow and the level it was built from, which `builtFrom` reads back.
const DESCRIBED = /^The CedarLoom workflow (\S+), at the automation level (supervised|checkpoint|auto)\.$/;

/** The workflow and level a package's manifest was built from; null for any other manifest. */
export const builtFrom = (manifest: unknown): { id: string; level: AutomationLevel } | null => {
  const description: unknown = Reflect.get(Object(manifest), "description");
  const [, id, level] = (typeof description === "string" ? DESCRIBED.exec(description) : null) ?? [];
  return id === undefined || (level !== "supervised" && level !== "checkpoint" && level !== "auto")
    ? null
    : { id, level };
};

/** A tool's plugin manifest: the step skills and that tool's stage skills, and its hooks file if it has one. */
export const manifestOf = (
  workflow: WorkflowDefinition,
  { plugin, level, folder, hooks }: { plugin: string; level: AutomationLevel; folder: string; hooks?: string },
): string => {
  const description = describe(`The CedarLoom workflow ${titleOf(workflow)}, at the automation level ${level}.`);
  const manifest = {
    name: plugin,
    version: workflow.metadata.version,
    description,
    skills: ["./steps/", folder],
    ...(hooks === undefined ? {} : { hooks }),
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
};
