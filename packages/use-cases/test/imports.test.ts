import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatInstalled, type Result } from "@cedarloom/contracts";
import { openStore } from "@cedarloom/git";
import { applyPlan, planExport, planImport, planSave, saveDraft } from "@cedarloom/use-cases";
import { expect, test } from "vitest";
import { gitFixtures, gitIdentity, ok, testRoot } from "./harness.ts";

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
  ok(applyPlan(state, ok(planExport(state, ["w"], folder, { name: "Team flows" })).plan, { yes: true }));
  return folder;
};
const refusal = <T>(result: Result<T>): unknown => (result.ok ? "planned" : result.finding);
const stored = (state: string): string => {
  const at = openStore(join(state, "store.git"));
  return ok(at.read(String(at.blob(String(at.head()), "workflows/workflow-w.json")))).toString("utf8");
};

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
});

test("an import updates a workflow stored as its last import left it, and keeps one edited here since", async () => {
  const [from, to] = [machine(), machine()];
  store(from, "1.0.0");
  ok(
    applyPlan(
      to,
      ok(await planImport(to, { folder: exported(from, join(from, "v1")) })).plan ?? {
        schemaVersion: 1,
        operations: [],
      },
      { yes: true },
    ),
  );
  store(from, "1.1.0", [{ id: "notify", type: "command.run", with: { command: "echo done" } }]);
  const update = ok(await planImport(to, { folder: exported(from, join(from, "v2")) }));
  ok(applyPlan(to, update.plan ?? { schemaVersion: 1, operations: [] }, { yes: true }));
  // Edited here: a version of this machine's own on top.
  store(to, "1.2.0", [], true);
  store(from, "1.3.0");
  const conflict = ok(await planImport(to, { folder: exported(from, join(from, "v3")) }));
  // Saved on another machine and never imported there: its own work, kept as well.
  const own = machine();
  store(own, "0.9.0");
  const never = ok(await planImport(own, { folder: join(from, "v3") }));
  expect([
    update.review.units[0],
    [...conflict.review.units, ...never.review.units].map(({ status }) => status),
    conflict.plan,
  ]).toEqual([
    {
      id: "w",
      status: "update",
      version: "1.1.0",
      stored: "1.0.0",
      license: null,
      changes: { added: ["notify"], removed: [], changed: [] },
    },
    ["conflict", "conflict"],
    null,
  ]);
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
    for (const name of ["cedarloom-export.json", "cedarloom.lock.json"]) {
      writeFileSync(join(linked, name), readFileSync(join(folder, name)));
    }
    symlinkSync(elsewhere, join(linked, "workflows"));
    expect(refusal(await planImport(machine(), { folder: linked }))).toEqual({
      code: "apply.symlink",
      params: { path: join(linked, "workflows") },
    });
  },
);

const { fetchLocal, publish } = gitFixtures(root);

// The extension the workflow uses, published as its own repository.
const JIRA = {
  schemaVersion: 1,
  kind: "cedarloom.extension",
  id: "acme.jira",
  version: "2.1.0",
  name: "Jira",
  api: "1.0",
  runtime: { kind: "node", entry: "main.mjs" },
  capabilities: { net: ["https://acme.atlassian.net"] },
  contributes: { actions: { search: { title: "Search" } } },
};

test("an import from Git fetches each extension it uses at its pinned commit, installs none, and refuses one whose files are not its digest's", async () => {
  const [from, to] = [machine(), machine()];
  const jira = publish("jira", { "cedarloom-extension.json": JSON.stringify(JIRA), "main.mjs": "" });
  const tree = ok(await fetchLocal({ url: jira, ref: "main" }, { parent: mkdtempSync(join(root, "fetch-")) }));
  const pin = { version: "2.1.0", source: { git: jira, commit: tree.commit }, digest: tree.digest };
  const installed = {
    schemaVersion: 1,
    kind: "cedarloom.extensions",
    extensions: { "acme.jira": { ...pin, ref: "main", consented: "c".repeat(64) } },
  } as const;
  writeFileSync(join(from, "extensions.json"), formatInstalled(installed));
  store(from, "1.0.0", [{ id: "search", type: "acme.jira/search" }]);
  const folder = exported(from, join(from, "shared"));
  const read = (path: string) => readFileSync(join(folder, ...path.split("/")), "utf8");
  const files = ["cedarloom-export.json", "cedarloom.lock.json", "workflows/workflow-w.json"];
  const flows = publish("flows", Object.fromEntries(files.map((path) => [path, read(path)])));
  const verified = ok(await planImport(to, { git: flows, ref: "main" }, fetchLocal));
  const lock = JSON.parse(read("cedarloom.lock.json"));
  lock.extensions["acme.jira"].digest = "f".repeat(64);
  const tampered = publish("tampered", {
    ...Object.fromEntries(files.map((path) => [path, read(path)])),
    "cedarloom.lock.json": JSON.stringify(lock),
  });
  const mismatch = await planImport(to, { git: tampered, ref: "main" }, fetchLocal);
  expect([
    verified.review.extensions,
    refusal(mismatch),
    verified.review.risks.find(({ kind }) => kind === "extension"),
  ]).toEqual([
    [
      {
        id: "acme.jira",
        version: "2.1.0",
        git: jira,
        commit: tree.commit,
        digest: tree.digest,
        status: "verified",
        installed: false,
        capabilities: { net: ["https://acme.atlassian.net"] },
      },
    ],
    { code: "extension.digest-mismatch", params: { extension: "acme.jira" } },
    { workflow: "w", node: "search", kind: "extension", text: "acme.jira/search" },
  ]);
});
