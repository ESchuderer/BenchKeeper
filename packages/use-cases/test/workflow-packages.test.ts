import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Plan, RunResult } from "@cedarloom/contracts";
import {
  applyPlan,
  type Folders,
  type InstallOptions,
  planPackageInstall,
  packageDoctor,
  planPackageUninstall,
  planSave,
  saveDraft,
  stableNode,
  undoRun,
} from "@cedarloom/use-cases";
import { expect, test, vi } from "vitest";
import { gitIdentity, ok, testRoot } from "./harness.ts";

// A released CedarLoom: a development build (0.0.0) loads files for a newer one.
vi.mock("../../profiles/src/version.ts", () => ({ APP_VERSION: "0.1.0" }));

const root = testRoot("packages");
gitIdentity(root);

const node = (id: string, type: string, config: object = {}) => ({ id, type, with: config });
const edge = (id: string, from: string, handle: string, to: string) => ({
  id,
  from: { node: from, handle },
  to: { node: to, handle: "run" },
});
// A precheck, a command, the merge gate and a command after it: two stages at Supervised, one at Auto.
const workflow = (id: string) => ({
  schemaVersion: 1,
  kind: "cedarloom.workflow",
  metadata: { id, name: id, version: "1.0.0" },
  nodes: [
    node("start", "trigger.manual", { precheck: "test -d .git" }),
    node("build", "command.run", { command: "echo build" }),
    node("g", "human.approval", { message: "Ship?", gate: "merge" }),
    node("ship", "command.run", { command: "echo ship" }),
  ],
  edges: [edge("e1", "start", "start", "build"), edge("e2", "build", "done", "g"), edge("e3", "g", "approved", "ship")],
});

// The user's own settings, which an install adds to and an uninstall leaves as they were.
const OWN = { model: "opus", permissions: { allow: ["Bash(ls)"] } };

// A machine whose store holds the workflows w and v, with the user's own settings in its Claude Code home.
const machine = (): Folders => {
  const dir = mkdtempSync(join(root, "machine-"));
  const folders = { config: join(dir, "config"), state: join(dir, "state"), home: join(dir, "claude") };
  for (const id of ["w", "v"]) {
    ok(saveDraft(folders.state, id, workflow(id), null));
    ok(applyPlan(folders.state, ok(planSave(folders.state, id)).plan, { yes: true }));
  }
  mkdirSync(folders.home, { recursive: true });
  writeFileSync(join(folders.home, "settings.json"), JSON.stringify(OWN));
  return folders;
};

const BUNDLES = { guard: "// guard\n", exits: "// exits\n" };
const install = (folders: Folders, id: string, more: Partial<InstallOptions> = {}): Plan | null =>
  ok(planPackageInstall(folders, id, { bundles: BUNDLES, node: "/usr/bin/node", allow: [id], ...more })).plan;
const applied = (folders: Folders, plan: Plan | null): RunResult => {
  if (plan === null) throw new Error("nothing planned");
  return ok(applyPlan(folders.state, plan, { yes: true }));
};
const settings = (folders: Folders): unknown => JSON.parse(readFileSync(join(folders.home, "settings.json"), "utf8"));

test("an install waits for approval by the plugin's name, listing what it runs; it writes the package and the rules of its stages and scripts, and its undo takes all back", () => {
  const folders = machine();
  const waiting = ok(planPackageInstall(folders, "w", { bundles: BUNDLES, node: "/usr/bin/node" }));
  const commands = ["test -d .git", "echo build", "echo ship"];
  expect(waiting.findings).toEqual([
    { code: "package.approval-needed", params: { id: "w", plugin: "w", level: "supervised", commands } },
  ]);
  const run = applied(folders, install(folders, "w"));
  const marketplace = join(folders.state, "workflow-packages");
  const folder = join(marketplace, "w");
  // Claude Code fills the plugin folder into a skill with forward slashes on Windows (C:/x), and matches a Read rule's
  // absolute path in POSIX form (/c/x).
  const slashed = `${marketplace.replaceAll("\\", "/")}/w`;
  const posix = slashed.replace(/^([A-Za-z]):/, (_drive, letter: string) => `/${letter.toLowerCase()}`);
  expect(settings(folders)).toEqual({
    model: "opus",
    permissions: {
      allow: [
        "Bash(ls)",
        "Workflow(w:run-start)",
        `Read(/${posix}/**)`,
        `Bash(sh "${slashed}/scripts/precheck.sh")`,
        `Bash(sh '${slashed}/steps/build/scripts/run.sh')`,
        `Bash(sh '${slashed}/steps/ship/scripts/run.sh')`,
      ],
      ask: ["Workflow(w:run-g-approved)"],
    },
    enabledPlugins: { "w@cedarloom-workflows": true },
    extraKnownMarketplaces: { "cedarloom-workflows": { source: { source: "directory", path: marketplace } } },
  });
  expect(readFileSync(join(folder, "hooks", "guard.mjs"), "utf8")).toBe("// guard\n");
  ok(undoRun(folders.state, run.runId ?? "", { yes: true }));
  expect([settings(folders), existsSync(join(folder, "hooks", "guard.mjs"))]).toEqual([OWN, false]);
});

test("installing at another level rebuilds the package in place, naming a package on the other side of Auto; uninstalling takes out its files, data and rules, and the marketplace with the last package", () => {
  const folders = machine();
  const marketplace = join(folders.state, "workflow-packages");
  const listed = (): unknown =>
    JSON.parse(readFileSync(join(marketplace, ".claude-plugin", "marketplace.json"), "utf8"));
  applied(folders, install(folders, "w"));
  applied(folders, install(folders, "v"));
  const rebuild = ok(
    planPackageInstall(folders, "w", { bundles: BUNDLES, node: "/usr/bin/node", allow: ["w"], level: "auto" }),
  );
  // v's guard, at Supervised, refuses the merges of w's stages in every session.
  expect(rebuild.findings).toEqual([
    { code: "package.levels-mixed", params: { id: "w", level: "auto", other: "v", otherLevel: "supervised" } },
  ]);
  applied(folders, rebuild.plan);
  // At Auto the merge gate passes, so the stage after it and the rule that asked before it go.
  expect(existsSync(join(marketplace, "w", "workflows", "run-g-approved.js"))).toBe(false);
  expect(Reflect.get(Object(settings(folders)), "permissions")).toMatchObject({ ask: ["Workflow(v:run-g-approved)"] });
  // What w's hooks kept goes with it.
  const data = join(folders.home, "plugins", "data", "w-cedarloom-workflows", "exits");
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, "session-agent"), "0");
  applied(folders, ok(planPackageUninstall(folders, "w")).plan);
  expect([existsSync(join(data, "session-agent")), existsSync(join(marketplace, "w", "hooks", "guard.mjs"))]).toEqual([
    false,
    false,
  ]);
  expect(listed()).toMatchObject({ plugins: [{ name: "v", source: "./v" }] });
  applied(folders, ok(planPackageUninstall(folders, "v")).plan);
  expect([settings(folders), existsSync(join(marketplace, ".claude-plugin", "marketplace.json"))]).toEqual([
    OWN,
    false,
  ]);
  expect(planPackageUninstall(folders, "v")).toEqual({
    ok: false,
    finding: { code: "package.not-installed", params: { id: "v" } },
  });
  // Five plans applied: over the default 5 s on the Windows runner.
}, 30_000);

// A link to it stays put when Homebrew moves the running Node.js to a new versioned folder.
test.skipIf(process.platform === "win32")(
  "the hooks run with the PATH's node where it links to the running one, else with the running one",
  () => {
    const [linked, other] = [mkdtempSync(join(root, "bin-")), mkdtempSync(join(root, "bin-"))];
    symlinkSync(process.execPath, join(linked, "node"));
    writeFileSync(join(other, "node"), "#!/bin/sh\n", { mode: 0o755 });
    expect([stableNode(process.execPath, { PATH: linked }), stableNode(process.execPath, { PATH: other })]).toEqual([
      join(linked, "node"),
      process.execPath,
    ]);
  },
);

test("the doctor reports a package whose hooks' Node.js is gone, and none once it is there again", () => {
  const folders = machine();
  const gone = join(root, "gone", "node");
  applied(folders, install(folders, "w", { node: gone }));
  const reported = packageDoctor(folders.state, join(root, "no-codex"));
  applied(folders, install(folders, "w", { node: process.execPath }));
  expect([reported, packageDoctor(folders.state, join(root, "no-codex"))]).toEqual([
    [{ code: "package.node-missing", params: { plugin: "w", path: gone, id: "w", level: "supervised" } }],
    [],
  ]);
});

test("the doctor reports a package Codex has no copy of, a copy older than the package, and one CedarLoom no longer installs", () => {
  const folders = machine();
  const codex = join(folders.state, "..", "codex");
  const cache = join(codex, "plugins", "cache", "cedarloom-workflows");
  const marketplace = join(folders.state, "workflow-packages");
  for (const id of ["w", "v"]) applied(folders, install(folders, id, { node: process.execPath }));
  // What `codex plugin add` leaves: w copied whole under its version, and a plugin since uninstalled from CedarLoom.
  cpSync(join(marketplace, "w"), join(cache, "w", "1.0.0"), { recursive: true });
  mkdirSync(join(cache, "gone", "1.0.0"), { recursive: true });
  const copies = (): unknown => packageDoctor(folders.state, codex);
  const before = copies();
  applied(folders, install(folders, "w", { node: process.execPath, level: "auto" }));
  expect([before, copies()]).toEqual([
    [
      { code: "package.codex-missing", params: { plugin: "v", id: "v" } },
      { code: "package.codex-left", params: { plugin: "gone" } },
    ],
    [
      { code: "package.codex-missing", params: { plugin: "v", id: "v" } },
      { code: "package.codex-stale", params: { plugin: "w", id: "w" } },
      { code: "package.codex-left", params: { plugin: "gone" } },
    ],
  ]);
});

test("a stored workflow for a newer CedarLoom installs nothing", () => {
  const folders = machine();
  const newer = { ...workflow("n"), metadata: { id: "n", name: "n", version: "1.0.0", minApp: "9.0.0" } };
  ok(saveDraft(folders.state, "n", newer, null));
  ok(applyPlan(folders.state, ok(planSave(folders.state, "n")).plan, { yes: true }));
  expect(planPackageInstall(folders, "n", { bundles: BUNDLES, node: "/usr/bin/node", allow: ["n"] })).toMatchObject({
    ok: false,
    finding: { code: "package.app-too-old", params: { id: "n", minApp: "9.0.0" } },
  });
});

test("two workflow ids that fold to one plugin name never share its package", () => {
  const folders = machine();
  for (const id of ["a_b", "a-b"]) {
    ok(saveDraft(folders.state, id, workflow(id), null));
    ok(applyPlan(folders.state, ok(planSave(folders.state, id)).plan, { yes: true }));
  }
  applied(folders, ok(planPackageInstall(folders, "a_b", { bundles: BUNDLES, node: "/usr/bin/node" })).plan);
  const taken = { ok: false, finding: { code: "package.plugin-taken", params: { plugin: "a-b", id: "a_b" } } };
  const options = { bundles: BUNDLES, node: "/usr/bin/node" };
  expect([planPackageInstall(folders, "a-b", options), planPackageUninstall(folders, "a-b")]).toEqual([taken, taken]);
});
