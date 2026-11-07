import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Result, RunResult, WorkflowDefinition } from "@cedarloom/contracts";
import { openStore } from "@cedarloom/git";
import {
  applyPlan,
  deleteDraft,
  openVersion,
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
const base = JSON.parse(readFileSync(join(corpus, "valid-build-and-review.json"), "utf8"));
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
