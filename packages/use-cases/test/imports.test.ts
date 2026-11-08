import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Result } from "@cedarloom/contracts";
import { openStore } from "@cedarloom/git";
import { applyPlan, planExport, planImport, planSave, saveDraft } from "@cedarloom/use-cases";
import { expect, test } from "vitest";
import { gitIdentity, ok, testRoot } from "./harness.ts";

const root = testRoot("imports");
gitIdentity(root);

const corpus = join(import.meta.dirname, "..", "..", "contracts", "corpus", "WorkflowDefinition", "1");
const base = JSON.parse(readFileSync(join(corpus, "valid-build-and-review.json"), "utf8"));
const machine = (): string => mkdtempSync(join(root, "state-"));
// Stores `version` of w (the corpus's build-and-review) on the machine, with `more` nodes.
const store = (state: string, version: string, more: object[] = [], onTop = false): void => {
  const workflow = { ...base, metadata: { ...base.metadata, id: "w", version }, nodes: [...base.nodes, ...more] };
  ok(saveDraft(state, "w", workflow, null));
  ok(applyPlan(state, ok(planSave(state, "w", { onTop })).plan, { yes: true }));
};
const exported = (state: string, folder: string): string => {
  ok(applyPlan(state, ok(planExport(state, ["w"], folder, { name: "Team flows" })), { yes: true }));
  return folder;
};
const refusal = <T>(result: Result<T>): unknown => (result.ok ? "planned" : result.finding);
const stored = (state: string): string => {
  const at = openStore(join(state, "store.git"));
  return ok(at.read(String(at.blob(String(at.head()), "workflows/workflow-w.json")))).toString("utf8");
};

// Each store commit and import runs git several times, which is slow on Windows: as git's own tests, 30 s.
test("an export imports as new byte for byte with every command and task in its review, then as the same", async () => {
  const [from, to] = [machine(), machine()];
  store(from, "1.0.0");
  const folder = exported(from, join(from, "shared"));
  const first = ok(await planImport(to, { folder }));
  ok(applyPlan(to, first.plan ?? { schemaVersion: 1, operations: [] }, { yes: true }));
  const again = ok(await planImport(to, { folder }));
  expect([
    first.review.units,
    first.review.risks.map(({ kind, text }) => [kind, text]),
    stored(to) === readFileSync(join(folder, "workflows", "workflow-w.json"), "utf8"),
    again.review.units.map(({ status }) => status),
    again.plan,
  ]).toEqual([
    [
      {
        id: "w",
        status: "new",
        version: "1.0.0",
        stored: null,
        license: null,
        changes: { added: ["approval", "lint", "review", "start", "tests"], removed: [], changed: [] },
      },
    ],
    [
      ["command", "pnpm lint"],
      ["agent", "Review the changes and list findings."],
      ["command", "pnpm test"],
    ],
    true,
    ["same"],
    null,
  ]);
}, 30_000);

// A machine that holds w as imported from another machine's export of version 1.0.0, and that other machine.
const imported = async (): Promise<{ from: string; to: string }> => {
  const [from, to] = [machine(), machine()];
  store(from, "1.0.0");
  const first = ok(await planImport(to, { folder: exported(from, join(from, "v1")) }));
  ok(applyPlan(to, first.plan ?? { schemaVersion: 1, operations: [] }, { yes: true }));
  return { from, to };
};

test("an import updates a workflow stored as its last import left it", async () => {
  const { from, to } = await imported();
  store(from, "1.1.0", [{ id: "notify", type: "command.run", with: { command: "echo done" } }]);
  const update = ok(await planImport(to, { folder: exported(from, join(from, "v2")) }));
  expect(update.review.units).toEqual([
    {
      id: "w",
      status: "update",
      version: "1.1.0",
      stored: "1.0.0",
      license: null,
      changes: { added: ["notify"], removed: [], changed: [] },
    },
  ]);
}, 30_000);

test("an import keeps a workflow edited here since its last import", async () => {
  const { from, to } = await imported();
  // Edited here: a version of this machine's own on top.
  store(to, "1.2.0", [], true);
  store(from, "1.3.0");
  const conflict = ok(await planImport(to, { folder: exported(from, join(from, "v3")) }));
  expect([conflict.review.units.map(({ status }) => status), conflict.plan]).toEqual([["conflict"], null]);
}, 30_000);

test("a workflow saved here and never imported is kept as a conflict: the import cannot tell which is newer", async () => {
  const [from, own] = [machine(), machine()];
  store(from, "1.0.0");
  store(own, "0.9.0");
  const never = ok(await planImport(own, { folder: exported(from, join(from, "shared")) }));
  expect([never.review.units.map(({ status }) => status), never.plan]).toEqual([["conflict"], null]);
});

test("an import refuses a workflow a save would refuse, such as one with an edge to no node", async () => {
  const from = machine();
  store(from, "1.0.0");
  const folder = exported(from, join(from, "shared"));
  const file = join(folder, "workflows", "workflow-w.json");
  const workflow = JSON.parse(readFileSync(file, "utf8"));
  workflow.edges.push({ id: "gone", from: { node: "start", handle: "start" }, to: { node: "nowhere", handle: "run" } });
  writeFileSync(file, JSON.stringify(workflow));
  expect(refusal(await planImport(machine(), { folder }))).toEqual({
    code: "workflow.dangling-edge",
    params: { edge: "gone", end: "to", ref: "nowhere" },
  });
});

test.skipIf(process.platform === "win32")(
  "an import refuses a link on the way to a workflow, which could lead anywhere on this machine",
  async () => {
    const from = machine();
    store(from, "1.0.0");
    const folder = exported(from, join(from, "shared"));
    // A shared clone's `workflows` pointing at a folder of the attacker's choosing.
    const elsewhere = join(from, "elsewhere");
    mkdirSync(elsewhere);
    writeFileSync(join(elsewhere, "workflow-w.json"), readFileSync(join(folder, "workflows", "workflow-w.json")));
    const linked = join(from, "linked");
    mkdirSync(linked);
    writeFileSync(join(linked, "cedarloom-export.json"), readFileSync(join(folder, "cedarloom-export.json")));
    symlinkSync(elsewhere, join(linked, "workflows"));
    expect(refusal(await planImport(machine(), { folder: linked }))).toEqual({
      code: "apply.symlink",
      params: { path: join(linked, "workflows") },
    });
  },
);
