import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
import { afterAll, expect, test } from "vitest";
import { gitIdentity } from "./harness.ts";

const root = mkdtempSync(join(process.env["RUNNER_TEMP"] ?? tmpdir(), "cedarloom-saves-"));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});
gitIdentity(root);

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
    store.commit(head, [["workflows/workflow-w.json", `${JSON.stringify(at("1.5.0"))}\n`]], "w 1.5.0\n"),
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

test("an export writes the index and each stored workflow byte for byte", () => {
  const dir = state();
  stored(dir, "1.0.0");
  const folder = join(dir, "shared");
  // Typed in another case, the id is listed as stored.
  ok(applyPlan(dir, ok(planExport(dir, ["W"], folder, { name: "Team flows" })), { yes: true }));
  const store = openStore(join(dir, "store.git"));
  const blob = String(store.blob(String(store.head()), "workflows/workflow-w.json"));
  const read = (path: string): string => readFileSync(join(folder, path), "utf8");
  expect([
    JSON.parse(read("cedarloom-export.json")),
    read("workflows/workflow-w.json") === ok(store.read(blob)).toString("utf8"),
  ]).toEqual([{ schemaVersion: 1, kind: "cedarloom.export", name: "Team flows", workflows: ["w"] }, true]);
});

test("an export refuses a workflow the store does not hold", () => {
  const dir = state();
  stored(dir, "1.0.0");
  expect(refusal(planExport(dir, ["v"], join(dir, "shared"), { name: "x" }))).toEqual({
    code: "store.not-found",
    params: { id: "v", commit: null },
  });
});

test("an export refuses a folder where it would write a file", () => {
  const dir = state();
  stored(dir, "1.0.0");
  const taken = join(dir, "taken");
  mkdirSync(join(taken, "cedarloom-export.json"), { recursive: true });
  expect(refusal(planExport(dir, ["w"], taken, { name: "x" }))).toEqual({
    code: "plan.not-a-file",
    params: { path: join(taken, "cedarloom-export.json"), error: "EISDIR" },
  });
});

test.skipIf(process.platform === "win32")(
  "an export refuses a link inside the folder, which would redirect a write",
  () => {
    const dir = state();
    stored(dir, "1.0.0");
    // A shared clone's `workflows` pointing at the drafts, which the export would replace.
    const shared = join(dir, "shared");
    mkdirSync(shared);
    symlinkSync(join(dir, "drafts"), join(shared, "workflows"));
    expect(refusal(planExport(dir, ["w"], shared, { name: "x" }))).toEqual({
      code: "apply.symlink",
      params: { path: join(shared, "workflows") },
    });
  },
);
