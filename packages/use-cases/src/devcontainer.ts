import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Finding } from "@cedarloom/contracts";
import { cleanEnv, missing, NETWORK_SETTINGS, programPath } from "@cedarloom/orchestration";
import { type Folder, filesIn, hasContainer, type Resolved } from "@cedarloom/profiles";

/** A dev container part's Template with its options and Features. */
type TemplateRequest = {
  template: string;
  args: Record<string, string>;
  features: Record<string, Record<string, string | boolean>>;
};
/** Applies a Template into an empty folder; why it failed, or null. */
export type ApplyTemplate = (folder: string, request: TemplateRequest) => Promise<string | null>;

// The Dev Containers CLI's `templates apply`, by its file, with only network settings and DOCKER_CONFIG, for 2 minutes.
// shortcut: on Windows npm installs the CLI as a .cmd, which needs a shell, so it is missing; run its script with Node.
export const devcontainerCli: ApplyTemplate = (folder, { template, args, features }) =>
  new Promise((done) => {
    // A .cmd, as npm installs the CLI there, runs only through a shell, and an install hint would mislead.
    if (process.platform === "win32") return done("on Windows CedarLoom cannot run the Dev Containers CLI yet");
    const env = cleanEnv(process.env, process.platform, [...NETWORK_SETTINGS, "DOCKER_CONFIG"]);
    const file = programPath("devcontainer", env);
    if (file === undefined) return done(missing("devcontainer"));
    const list = Object.entries(features).map(([id, options]) => ({ id, options }));
    const argv = ["templates", "apply", "--workspace-folder", folder, "--template-id", template];
    argv.push("--template-args", JSON.stringify(args), "--features", JSON.stringify(list));
    const options = { cwd: folder, env, windowsHide: true, timeout: 120_000, killSignal: "SIGKILL" as const };
    execFile(file, argv, options, (error, _stdout, stderr) =>
      done(error === null ? null : stderr.trim().split("\n").at(-1) || error.message),
    );
  });

// Applies each approved part's Template in scratch unless the project has a dev container; a failure writes nothing.
export const templatesOf = async (
  state: string,
  resolved: Resolved,
  { project, approved, apply }: { project: string; approved: ReadonlySet<string>; apply: ApplyTemplate },
): Promise<{ templates: Map<string, Folder>; findings: Finding[] }> => {
  const templates = new Map<string, Folder>();
  const findings: Finding[] = [];
  const parts = Object.entries(resolved.profile.project).flatMap(([id, part]) =>
    part.type === "devcontainer" && resolved.on.has(`project.${id}`) && approved.has(`project.${id}`)
      ? [{ id, part }]
      : [],
  );
  for (const { id, part } of hasContainer(project) ? [] : parts) {
    mkdirSync(join(state, "templates"), { recursive: true });
    const folder = mkdtempSync(join(state, "templates", "t-"));
    try {
      const error = await apply(folder, {
        template: part.template,
        args: part.args ?? {},
        features: part.features ?? {},
      });
      if (error === null) templates.set(id, { files: filesIn(folder) });
      else
        findings.push({
          code: "profile.template-failed",
          params: { part: `project.${id}`, template: part.template, error },
        });
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }
  return { templates, findings };
};
