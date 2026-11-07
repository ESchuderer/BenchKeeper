import { execFile } from "node:child_process";
import { accessSync, constants, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join, relative, sep } from "node:path";
import type { Finding } from "@cedarloom/contracts";
import { cleanEnv, NETWORK_SETTINGS } from "@cedarloom/orchestration";
import { type Folder, hasContainer, type Resolved } from "@cedarloom/profiles";

/** A dev container part's Template with its options and Features. */
type TemplateRequest = {
  template: string;
  args: Record<string, string>;
  features: Record<string, Record<string, string | boolean>>;
};
/** Applies a Template into an empty folder; why it failed, or null. */
export type ApplyTemplate = (folder: string, request: TemplateRequest) => Promise<string | null>;

// A file this user may run, as host/exec's `located` requires.
const runnable = (file: string): boolean => {
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
};

// The CLI's file in an absolute folder of PATH, as a relative one would follow the current folder.
const cliFile = (env: Record<string, string>): string | undefined =>
  (env["PATH"] ?? "")
    .split(delimiter)
    .filter((folder) => isAbsolute(folder))
    .map((folder) => join(folder, "devcontainer"))
    .find((file) => runnable(file));

/**
 * `devcontainer templates apply` of the Dev Containers CLI, run by its file without a shell, with the network settings
 * and Docker's registry logins (DOCKER_CONFIG) and nothing else of the environment, stopped after 2 minutes.
 * shortcut: on Windows npm installs the CLI as a .cmd, which runs only through a shell, so a dev container part reports
 * the CLI missing there; due once CedarLoom runs the CLI's own script with Node.
 */
export const devcontainerCli: ApplyTemplate = (folder, { template, args, features }) =>
  new Promise((done) => {
    // A .cmd, as npm installs the CLI there, runs only through a shell, and an install hint would mislead.
    if (process.platform === "win32") return done("on Windows CedarLoom cannot run the Dev Containers CLI yet");
    const env = cleanEnv(process.env, process.platform, [...NETWORK_SETTINGS, "DOCKER_CONFIG"]);
    const file = cliFile(env);
    if (file === undefined) return done("ENOENT: no devcontainer program in the absolute folders of PATH");
    const list = Object.entries(features).map(([id, options]) => ({ id, options }));
    const argv = ["templates", "apply", "--workspace-folder", folder, "--template-id", template];
    argv.push("--template-args", JSON.stringify(args), "--features", JSON.stringify(list));
    const options = { cwd: folder, env, windowsHide: true, timeout: 120_000, killSignal: "SIGKILL" as const };
    execFile(file, argv, options, (error, _stdout, stderr) =>
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
 * Applies the Template of each dev container part that is on and approved in a scratch folder of the state and reads
 * what it wrote, unless the project has a dev container already, whose files the part would leave as they are. A part
 * not approved yet waits without a download, and a Template that fails is reported and writes nothing.
 */
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
