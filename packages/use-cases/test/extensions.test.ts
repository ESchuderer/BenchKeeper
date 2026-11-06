import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { type Finding, InstalledExtensions } from "@cedarloom/contracts";
import { fetchTreeOver } from "@cedarloom/git";
import { applyPlan, type Fetch, installedExtensions, planInstall, undoRun } from "@cedarloom/use-cases";
import { afterAll, expect, test } from "vitest";

// GitHub's Windows runners keep os.tmpdir() on the slow system drive.
const root = mkdtempSync(join(process.env["RUNNER_TEMP"] ?? tmpdir(), "cedarloom-install-"));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const git = (cwd: string, args: string[]): string =>
  execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.org", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();

// Each published URL is a local repository: the tests let git fetch over file://, which the CLI never does.
const repositories = new Map<string, string>();
const fetchLocal: Fetch = (source, options) =>
  fetchTreeOver(["file"])({ ...source, url: repositories.get(source.url) ?? source.url }, options);
const publish = (name: string, files: Record<string, string>): string => {
  const dir = mkdtempSync(join(root, "repository-"));
  git(dir, ["init", "--quiet", "--initial-branch=main"]);
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
  const url = `https://git.example.org/acme/${name}.git`;
  repositories.set(url, pathToFileURL(dir).href);
  return url;
};

const manifest = (more: object = {}): string =>
  JSON.stringify({
    schemaVersion: 1,
    kind: "cedarloom.extension",
    id: "acme.jira",
    version: "1.0.0",
    name: "Jira",
    api: "1.0",
    runtime: { kind: "node", entry: "main.mjs" },
    capabilities: { net: ["https://acme.atlassian.net"] },
    contributes: { actions: { search: { title: "Search" } } },
    ...more,
  });
// Run, the entry would leave a marker in its folder; an install never runs it.
const ENTRY = 'import { writeFileSync } from "node:fs";\nwriteFileSync(new URL("ran", import.meta.url), "x");\n';
const state = (): string => mkdtempSync(join(root, "state-"));
const findingOf = (result: { ok: boolean; finding?: Finding }): unknown => (result.ok ? "planned" : result.finding);

test("an install pins the commit and digest, stages the files read-only by digest, and plans one write; nothing runs", async () => {
  const at = state();
  const url = publish("jira", { "cedarloom-extension.json": manifest(), "main.mjs": ENTRY });
  const planned = await planInstall(at, { url, ref: "main" }, fetchLocal);
  if (!planned.ok) throw new Error(planned.finding.code);
  const { plan, pin } = planned.value;
  const [write] = plan.operations;
  const folder = join(at, "extensions", "acme.jira", pin.digest);
  const staged = readdirSync(folder).toSorted();
  expect([plan.operations.length, write?.kind, write?.path, write?.before]).toEqual([
    1,
    "write",
    join(at, "extensions.json"),
    null,
  ]);
  expect(InstalledExtensions.parse(JSON.parse(write?.kind === "write" ? write.content : "")).extensions).toEqual({
    "acme.jira": {
      version: "1.0.0",
      source: { git: url, commit: expect.stringMatching(/^[0-9a-f]{40}$/) },
      digest: expect.stringMatching(/^[0-9a-f]{64}$/),
      ref: "main",
      consented: expect.stringMatching(/^[0-9a-f]{64}$/),
    },
  });
  expect([staged, statSync(join(folder, "main.mjs")).mode & 0o222, existsSync(join(folder, "ran"))]).toEqual([
    ["cedarloom-extension.json", "main.mjs"],
    0,
    false,
  ]);
});

test("an applied install is listed as community code, and its undo restores the installed set", async () => {
  const at = state();
  const url = publish("tools", {
    "README.md": "not part of the extension",
    "extensions/tools/cedarloom-extension.json": manifest({ id: "acme.tools" }),
    "extensions/tools/main.mjs": ENTRY,
    "extensions/tools/bin/run.sh": "#!/bin/sh\n",
  });
  const tools = { url, ref: "HEAD", path: "extensions/tools" };
  const planned = await planInstall(at, tools, fetchLocal);
  if (!planned.ok) throw new Error(planned.finding.code);
  const run = applyPlan(at, planned.value.plan, { yes: true });
  const listed = installedExtensions(at);
  const again = await planInstall(at, tools, fetchLocal);
  const runId = run.ok ? String(run.value.runId) : "";
  const undone = undoRun(at, runId, { yes: true });
  // The staged folder outlives the undo, inert, and a new install takes it as it is.
  const reinstalled = await planInstall(at, tools, fetchLocal);
  const script = join(at, "extensions", "acme.tools", planned.value.pin.digest, "bin", "run.sh");
  expect([listed.ok ? listed.value.map(({ id, trust, source }) => [id, trust, source.path]) : listed]).toEqual([
    [["acme.tools", "community", "extensions/tools"]],
  ]);
  expect([findingOf(again), undone.ok && undone.value.status, existsSync(join(at, "extensions.json"))]).toEqual([
    { code: "extension.install-refused", params: { extension: "acme.tools", reason: "installed" } },
    "applied",
    false,
  ]);
  expect([findingOf(reinstalled), statSync(script).mode & 0o222]).toEqual(["planned", 0]);
});

test("a second extension joins the installed set; the plan replaces the file it read", async () => {
  const at = state();
  const first = await planInstall(
    at,
    { url: publish("one", { "cedarloom-extension.json": manifest(), "main.mjs": ENTRY }), ref: "main" },
    fetchLocal,
  );
  if (first.ok) applyPlan(at, first.value.plan, { yes: true });
  const text = readFileSync(join(at, "extensions.json"), "utf8");
  const second = await planInstall(
    at,
    {
      url: publish("two", { "cedarloom-extension.json": manifest({ id: "acme.two" }), "main.mjs": ENTRY }),
      ref: "main",
    },
    fetchLocal,
  );
  if (!second.ok) throw new Error(second.finding.code);
  const [write] = second.value.plan.operations;
  const content = write?.kind === "write" ? write.content : "";
  expect([
    write?.before === null,
    Object.keys(InstalledExtensions.parse(JSON.parse(content)).extensions),
    text.length > 0,
  ]).toEqual([false, ["acme.jira", "acme.two"], true]);
});

test("no install without a manifest, with an invalid one (the cedarloom publisher), without its entry, for another protocol, or from a refused source", async () => {
  const at = state();
  const sources = [
    publish("bare", { "main.mjs": ENTRY }),
    publish("first-party", { "cedarloom-extension.json": manifest({ id: "cedarloom.jira" }), "main.mjs": ENTRY }),
    publish("no-entry", { "cedarloom-extension.json": manifest() }),
    publish("future", { "cedarloom-extension.json": manifest({ api: "2.0" }), "main.mjs": ENTRY }),
  ];
  const results = await Promise.all([
    ...sources.map((url) => planInstall(at, { url, ref: "main" }, fetchLocal)),
    planInstall(at, { url: sources[0] ?? "", ref: "-x" }, fetchLocal),
  ]);
  expect([...results.map(findingOf), existsSync(join(at, "extensions"))]).toEqual([
    { code: "extension.install-refused", params: { extension: null, reason: "no-manifest" } },
    { code: "document.invalid", params: { issues: [expect.objectContaining({ path: "id" })] } },
    { code: "extension.install-refused", params: { extension: "acme.jira", reason: "entry" } },
    { code: "extension.install-refused", params: { extension: "acme.jira", reason: "protocol" } },
    { code: "git.refused-source", params: { field: "ref" } },
    false,
  ]);
});

test("an installed set CedarLoom cannot read refuses installs and the list alike", async () => {
  const [newer, folder] = [state(), state()];
  writeFileSync(join(newer, "extensions.json"), '{"schemaVersion":2}');
  mkdirSync(join(folder, "extensions.json"));
  const url = publish("blocked", { "cedarloom-extension.json": manifest(), "main.mjs": ENTRY });
  expect([
    findingOf(await planInstall(newer, { url, ref: "main" }, fetchLocal)),
    findingOf(installedExtensions(newer)),
    findingOf(installedExtensions(folder)),
  ]).toEqual([
    { code: "document.newer-schema", params: { found: 2, known: 1 } },
    { code: "document.newer-schema", params: { found: 2, known: 1 } },
    { code: "document.unreadable", params: { path: join(folder, "extensions.json"), error: expect.any(String) } },
  ]);
});

// A file of a tree handed over without Git, and the finding of a stage that failed.
const fileOf = (path: string, text: string) => ({
  path,
  mode: "100644" as const,
  sha256: "0".repeat(64),
  content: Buffer.from(text),
});

const stageFailed = (error: unknown) => ({
  code: "extension.failed",
  params: { extension: expect.any(String), step: "stage", error },
});

test("a failure to stage the files is a finding, and leaves no staging folder behind", async () => {
  const folder = state();
  // A name longer than any file system takes: the write fails after the staging folder exists.
  const tooLong: Fetch = () =>
    Promise.resolve({
      ok: true,
      value: {
        commit: "a".repeat(40),
        digest: "b".repeat(64),
        files: [
          fileOf("cedarloom-extension.json", manifest()),
          fileOf("main.mjs", ENTRY),
          fileOf(`${"x".repeat(300)}.txt`, ""),
        ],
      },
    });
  const failed = await planInstall(folder, { url: "https://git.example.org/acme/long.git", ref: "main" }, tooLong);
  mkdirSync(join(folder, "extensions"), { recursive: true });
  writeFileSync(join(folder, "extensions", "acme.two"), "a file where its folder goes");
  const blocked = await planInstall(
    folder,
    {
      url: publish("blocked-folder", { "cedarloom-extension.json": manifest({ id: "acme.two" }), "main.mjs": ENTRY }),
      ref: "main",
    },
    fetchLocal,
  );
  expect([findingOf(failed), findingOf(blocked), readdirSync(join(folder, "extensions", "acme.jira"))]).toEqual([
    // The error code only (ENAMETOOLONG; Windows says ENOENT), never a message with the extension's paths.
    stageFailed(expect.stringMatching(/^E[A-Z]+$/)),
    stageFailed(expect.stringMatching(/^E[A-Z]+$/)),
    [],
  ]);
});
