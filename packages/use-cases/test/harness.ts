import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Result } from "@cedarloom/contracts";
import { fetchTreeOver } from "@cedarloom/git";
import type { Fetch } from "@cedarloom/use-cases";
import { afterAll, afterEach, beforeEach, vi } from "vitest";

/** A folder for one test file's runs, removed after them; under RUNNER_TEMP on CI, where the system temp is slow. */
export const testRoot = (name: string): string => {
  const root = mkdtempSync(join(process.env["RUNNER_TEMP"] ?? tmpdir(), `cedarloom-${name}-`));
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });
  return root;
};

/** The value of a result; a refusal fails the test with its code. */
export const ok = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(`refused: ${result.finding.code}`);
  return result.value;
};

const git = (cwd: string, args: string[]): string =>
  execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.org", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();

/** Store commits carry the user's Git identity: each test gets a home folder of its own under `root` that gives one. */
export const gitIdentity = (root: string): void => {
  beforeEach(() => {
    const home = mkdtempSync(join(root, "home-"));
    writeFileSync(join(home, ".gitconfig"), "[user]\n\tname = Ada\n\temail = ada@example.org\n");
    vi.stubEnv("HOME", home);
    vi.stubEnv("XDG_CONFIG_HOME", home);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
};

/**
 * Local repositories under the published URLs `https://git.example.org/acme/<name>.git`, in `root`, which tests fetch
 * over file:// (CedarLoom never does): `publish` makes or extends one, `fetchLocal` fetches through them.
 */
export const gitFixtures = (root: string) => {
  // Each published URL is a local repository: the tests let git fetch over file://, which the CLI never does.
  const repositories = new Map<string, string>();
  const fetchLocal: Fetch = (source, options) => {
    const folder = repositories.get(source.url);
    return fetchTreeOver(["file"])(
      { ...source, url: folder === undefined ? source.url : pathToFileURL(folder).href },
      options,
    );
  };
  // Publishes the files as the newest commit of the repository `name`, a new one or the next commit of one published before.
  const publish = (name: string, files: Record<string, string>): string => {
    const url = `https://git.example.org/acme/${name}.git`;
    const known = repositories.get(url);
    const dir = known ?? mkdtempSync(join(root, "repository-"));
    if (known === undefined) git(dir, ["init", "--quiet", "--initial-branch=main"]);
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    git(dir, ["add", "--all"]);
    // Shell scripts are executable in the commit, also where the file system has no such bit.
    for (const path of Object.keys(files).filter((file) => file.endsWith(".sh"))) {
      git(dir, ["update-index", "--chmod=+x", path]);
    }
    git(dir, ["commit", "--quiet", "--message=publish"]);
    repositories.set(url, dir);
    return url;
  };
  return { fetchLocal, publish, repositories };
};
