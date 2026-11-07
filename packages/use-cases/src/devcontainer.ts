import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Result } from "@cedarloom/contracts";
import { cleanEnv, NETWORK_SETTINGS } from "@cedarloom/orchestration";
import type { Folder, Resolved } from "@cedarloom/profiles";

/** A dev container part's Template with its options and Features. */
type TemplateRequest = {
  template: string;
  args: Record<string, string>;
  features: Record<string, Record<string, string | boolean>>;
};
/** Applies a Template into an empty folder; why it failed, or null. */
export type ApplyTemplate = (folder: string, request: TemplateRequest) => Promise<string | null>;

/**
 * `devcontainer templates apply` of the Dev Containers CLI, without a shell, with the network settings and nothing else
 * of the environment, stopped after 2 minutes. shortcut: on Windows npm installs the CLI as a .cmd, which runs only
 * through a shell, so a dev container part fails there; due once CedarLoom runs the CLI's own script with Node.
 */
export const devcontainerCli: ApplyTemplate = (folder, { template, args, features }) =>
  new Promise((done) => {
    const list = Object.entries(features).map(([id, options]) => ({ id, options }));
    const argv = ["templates", "apply", "--workspace-folder", folder, "--template-id", template];
    argv.push("--template-args", JSON.stringify(args), "--features", JSON.stringify(list));
    const env = cleanEnv(process.env, process.platform, NETWORK_SETTINGS);
    const options = { cwd: folder, env, windowsHide: true, timeout: 120_000, killSignal: "SIGKILL" as const };
    execFile("devcontainer", argv, options, (error, _stdout, stderr) =>
      done(error === null ? null : stderr.trim().split("\n").at(-1) || error.message),
    );
  });

// The files below a folder by their paths in it; a link is no file, so nothing outside it is read.
const filesIn = (folder: string): Folder["files"] =>
  readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return { path: relative(folder, path).split(sep).join("/"), mode: "100644", content: readFileSync(path) };
    });

/**
 * Applies the Template of each dev container part that is on in a scratch folder of the state and reads what it wrote,
 * unless the project has a dev container already, whose files the part would leave as they are. A Template that fails
 * stops the plan.
 */
export const templatesOf = async (
  state: string,
  resolved: Resolved,
  { container, apply }: { container: boolean; apply: ApplyTemplate },
): Promise<Result<Map<string, Folder>>> => {
  const templates = new Map<string, Folder>();
  const parts = Object.entries(resolved.profile.project).filter(([id]) => resolved.on.has(`project.${id}`));
  for (const [id, part] of container ? [] : parts) {
    if (part.type !== "devcontainer") continue;
    mkdirSync(join(state, "templates"), { recursive: true });
    const folder = mkdtempSync(join(state, "templates", "t-"));
    try {
      const error = await apply(folder, {
        template: part.template,
        args: part.args ?? {},
        features: part.features ?? {},
      });
      if (error !== null) {
        const params = { part: `project.${id}`, template: part.template, error };
        return { ok: false, finding: { code: "profile.template-failed", params } };
      }
      templates.set(id, { files: filesIn(folder) });
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }
  return { ok: true, value: templates };
};
