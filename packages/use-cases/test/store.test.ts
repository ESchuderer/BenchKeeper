import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Result, RunResult, WorkflowDefinition } from "@cedarloom/contracts";
import { openStore } from "@cedarloom/git";
import {
  applyPlan,
  deleteDraft,
  openVersion,
  planExport,
  planSave,
  readDraft,
  saveDraft,
  storeHistory,
  undoRun,
} from "@cedarloom/use-cases";
import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";

const root = mkdtempSync(join(process.env["RUNNER_TEMP"] ?? tmpdir(), "cedarloom-saves-"));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});
// Store commits carry the user's Git identity: a home folder of the tests' own gives one.
beforeEach(() => {
  const home = mkdtempSync(join(root, "home-"));
  writeFileSync(join(home, ".gitconfig"), "[user]\n\tname = Ada\n\temail = ada@example.org\n");
  vi.stubEnv("HOME", home);
  vi.stubEnv("XDG_CONFIG_HOME", home);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const corpus = join(import.meta.dirname, "..", "..", "contracts", "corpus", "WorkflowDefinition", "1");
const sample = (name: string) => JSON.parse(readFileSync(join(corpus, name), "utf8"));
const base = sample("valid-build-and-review.json");
const at = (version: string): WorkflowDefinition => ({ ...base, metadata: { ...base.metadata, id: "w", version } });
const state = (): string => mkdtempSync(join(root, "state-"));

const ok = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(`refused: ${result.finding.code}`);
  return result.value;
};
const refusal = (result: Result<unknown>): unknown => (result.ok ? "planned" : result.finding);
// Writes `version` as the draft of w, then stores it as one run.
const stored = (dir: string, version: string, onTop = false): RunResult => {
  ok(saveDraft(dir, "w", at(version), null));
  return ok(applyPlan(dir, ok(planSave(dir, "w", { onTop })).plan, { yes: true }));
};
const versionOf = (workflow: unknown): unknown =>
  Reflect.get(Object(Reflect.get(Object(workflow), "metadata")), "version");
const versions = (dir: string): (string | null)[] => ok(storeHistory(dir, "w")).map(({ version }) => version);

test("a stored version moves the store's branch, undo moves it back, and the draft's base goes back with it", () => {
  const dir = state();
  stored(dir, "1.0.0");
  const second = stored(dir, "1.1.0");
  const undone = ok(undoRun(dir, String(second.runId), { yes: true }));
  const afterUndo = versions(dir);
  // The base is 1.0.0's again, so the draft stores without a conflict.
  const again = stored(dir, "1.1.0");
  expect([second.status, undone.status, afterUndo, again.status, versions(dir)]).toEqual([
    "applied",
    "applied",
    ["1.0.0"],
    "applied",
    ["1.1.0", "1.0.0"],
  ]);
});

test("a plan whose branch moved since it was made writes nothing", () => {
  const dir = state();
  ok(saveDraft(dir, "w", at("1.0.0"), null));
  const early = ok(planSave(dir, "w")).plan;
  ok(applyPlan(dir, ok(planSave(dir, "w")).plan, { yes: true }));
  const late = ok(applyPlan(dir, early, { yes: true }));
  expect([late.status, late.findings.map(({ code }) => code), versions(dir)]).toEqual([
    "refused",
    ["store.moved", "plan.file-changed"],
    ["1.0.0"],
  ]);
});

test("a draft opened from another stored version than the one there now is stored only on top of it", () => {
  const dir = state();
  stored(dir, "1.0.0");
  // An import stores another version meanwhile.
  const store = openStore(join(dir, "store.git"));
  const head = store.head();
  const { commit } = ok(
    store.commit(head, "workflows/workflow-w.json", `${JSON.stringify(at("1.5.0"))}\n`, "w 1.5.0\n"),
  );
  store.move(commit, head);
  ok(saveDraft(dir, "w", at("2.0.0"), null));
  const conflict = refusal(planSave(dir, "w"));
  const onTop = stored(dir, "2.0.0", true);
  expect([conflict, onTop.status, versions(dir)]).toEqual([
    { code: "store.conflict", params: { id: "w" } },
    "applied",
    ["2.0.0", "1.5.0", "1.0.0"],
  ]);
});

test("a version must rise in semver precedence, where 1.10.0 is above 1.9.0", () => {
  const dir = state();
  stored(dir, "1.9.0");
  ok(saveDraft(dir, "w", at("1.9.0"), null));
  const same = refusal(planSave(dir, "w"));
  ok(saveDraft(dir, "w", at("1.10.0-rc.1"), null));
  expect([same, refusal(planSave(dir, "w"))]).toEqual([
    { code: "store.version-not-higher", params: { id: "w", stored: "1.9.0", found: "1.9.0" } },
    "planned",
  ]);
});

test("a stored version opens as the draft, based on that version, and never over a draft", () => {
  const dir = state();
  stored(dir, "1.0.0");
  stored(dir, "1.1.0");
  const [, older] = ok(storeHistory(dir, "w"));
  ok(deleteDraft(dir, "w"));
  ok(openVersion(dir, "w", older?.commit.slice(0, 12)));
  const opened = versionOf(ok(readDraft(dir, "w")).workflow);
  expect([opened, refusal(openVersion(dir, "w")), refusal(planSave(dir, "w"))]).toEqual([
    "1.0.0",
    { code: "store.draft-exists", params: { id: "w" } },
    { code: "store.conflict", params: { id: "w" } },
  ]);
});

test("a validation error refuses a save, and a missing extension alone does not", () => {
  const dir = state();
  const twin = sample("findings-duplicate-edge.json");
  ok(saveDraft(dir, "w", { ...twin, metadata: { ...twin.metadata, id: "w" } }, null));
  const refused = refusal(planSave(dir, "w"));
  const minimal = sample("valid-minimal.json");
  const nodes = [...minimal.nodes, { id: "jira", type: "acme.jira/search-issues" }];
  ok(saveDraft(dir, "w", { ...minimal, metadata: { ...minimal.metadata, id: "w" }, nodes }, null));
  expect([refused, refusal(planSave(dir, "w"))]).toEqual([
    { code: "workflow.duplicate-edge", params: { edge: "twin", of: "first" } },
    "planned",
  ]);
});

test("a branch git cannot move, its ref locked by another process, is git's failure, not a moved branch", () => {
  const dir = state();
  stored(dir, "1.0.0");
  ok(saveDraft(dir, "w", at("1.1.0"), null));
  const { plan } = ok(planSave(dir, "w"));
  mkdirSync(join(dir, "store.git", "refs", "heads"), { recursive: true });
  writeFileSync(join(dir, "store.git", "refs", "heads", "main.lock"), "");
  const locked = ok(applyPlan(dir, plan, { yes: true }));
  expect([locked.status, locked.findings, versions(dir)]).toEqual([
    "failed",
    [
      { code: "git.failed", params: { step: "update", error: expect.stringContaining("main.lock") } },
      { code: "run.failed", params: { runId: locked.runId, undoes: null } },
    ],
    ["1.0.0"],
  ]);
});

// A stored workflow w that uses the extension acme.jira.
const storedWithExtension = (dir: string): void => {
  const minimal = sample("valid-minimal.json");
  const nodes = [...minimal.nodes, { id: "jira", type: "acme.jira/search-issues" }];
  ok(saveDraft(dir, "w", { ...minimal, metadata: { ...minimal.metadata, id: "w" }, nodes }, null));
  ok(applyPlan(dir, ok(planSave(dir, "w")).plan, { yes: true }));
};

test("an export writes the index, each stored workflow byte for byte, and the lock of the extensions they use", () => {
  const dir = state();
  storedWithExtension(dir);
  const installed = join(corpus, "..", "..", "InstalledExtensions", "1", "valid-installed.json");
  writeFileSync(join(dir, "extensions.json"), readFileSync(installed));
  const folder = join(dir, "shared");
  const { plan, extensions } = ok(planExport(dir, ["w"], folder, { name: "Team flows" }));
  ok(applyPlan(dir, plan, { yes: true }));
  const store = openStore(join(dir, "store.git"));
  const blob = String(store.blob(String(store.head()), "workflows/workflow-w.json"));
  const read = (path: string): string => readFileSync(join(folder, path), "utf8");
  expect([
    extensions,
    JSON.parse(read("cedarloom-export.json")),
    JSON.parse(read("cedarloom.lock.json")),
    read("workflows/workflow-w.json") === ok(store.read(blob)).toString("utf8"),
  ]).toEqual([
    ["acme.jira"],
    { schemaVersion: 1, kind: "cedarloom.export", name: "Team flows", workflows: ["w"] },
    {
      schemaVersion: 1,
      kind: "cedarloom.lock",
      extensions: {
        "acme.jira": {
          version: "2.1.0",
          source: { git: "https://git.example.org/acme/jira.git", commit: "9b2e4c1f0a8d7e6b5c4a3f2e1d0c9b8a7f6e5d4c" },
          digest: "3f0c6d1e2b4a59687a8b9c0d1e2f30415263748596a7b8c9d0e1f2031425364a",
        },
      },
    },
    true,
  ]);
});

test("an export refuses a workflow the store does not hold, and an extension not installed here", () => {
  const dir = state();
  storedWithExtension(dir);
  const folder = join(dir, "shared");
  expect([
    refusal(planExport(dir, ["v"], folder, { name: "x" })),
    refusal(planExport(dir, ["w"], folder, { name: "x" })),
  ]).toEqual([
    { code: "store.not-found", params: { id: "v", commit: null } },
    { code: "extension.unknown", params: { extension: "acme.jira" } },
  ]);
});
