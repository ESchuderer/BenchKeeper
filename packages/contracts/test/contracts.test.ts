import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ACCOUNTS_SCHEMA_VERSION,
  AccountRegistry,
  canonicalJson,
  formatRegistry,
  type Json,
  formatWorkflow,
  isCron,
  NODE_CONFIGS,
  PLAN_SCHEMA_VERSION,
  Plan,
  readDocument,
  type Result,
  WORKFLOW_SCHEMA_VERSION,
  WorkflowDefinition,
} from "@cedarloom/contracts";
import * as fc from "fast-check";
import { describe, expect, test } from "vitest";

const KNOWN = 1;

const expectedCode = (version: string, name: string, known = KNOWN): string | undefined => {
  if (Number(version) > known) return "document.newer-schema";
  return name.startsWith("invalid-") ? "document.invalid" : undefined;
};

/** The golden files of one contract as [version folder, file name, text]. */
const corpus = async (contract: string): Promise<[string, string, string][]> => {
  const root = join(import.meta.dirname, "..", "corpus", contract);
  const versions = await readdir(root);
  const files = await Promise.all(
    versions.map(async (version) => (await readdir(join(root, version))).map((name) => [version, name] as const)),
  );
  return Promise.all(
    files.flat().map(async ([version, name]): Promise<[string, string, string]> => {
      return [version, name, await readFile(join(root, version, name), "utf8")];
    }),
  );
};

describe("golden corpus of plans, one folder per schemaVersion", async () => {
  for (const [version, name, text] of await corpus("Plan")) {
    test(`${version}/${name}`, () => {
      const read = readDocument(Plan, KNOWN, JSON.parse(text));
      expect(read.ok ? undefined : read.finding.code).toBe(expectedCode(version, name));
    });
  }
});

// Each invalid workflow breaks in one place, the one its name promises.
const promised: Record<string, string[]> = {
  "invalid-bad-node-id.json": ["nodes.0.id"],
  "invalid-default-type.json": ["inputs.count.default"],
  "invalid-unknown-execution-key.json": ["execution.parallel"],
  "invalid-edge-without-id.json": ["edges.0.id"],
  "invalid-no-nodes.json": ["nodes"],
  "invalid-other-kind.json": ["kind"],
  "invalid-position-in-node.json": ["nodes.0.x", "nodes.0.y"],
  "invalid-string-version.json": ["schemaVersion"],
  "invalid-too-deep.json": [`nodes.0.with.args.${Array.from({ length: 28 }, () => "0").join(".")}`],
  "invalid-unknown-data-type.json": ["inputs.when.type"],
};

const issuePaths = (read: Result<unknown>): string[] =>
  !read.ok && read.finding.code === "document.invalid" ? read.finding.params.issues.map((issue) => issue.path) : [];

// Each invalid registry breaks in one place, the one its name promises; a credential is an unknown key.
const promisedAccounts: Record<string, string[]> = {
  "invalid-confirmed-codex-pool.json": ["pools.codex.main.confirmedAt"],
  "invalid-duplicate-home.json": ["accounts.1.home"],
  "invalid-duplicate-name.json": ["accounts.1.name"],
  "invalid-inherited-pool.json": ["accounts.0.pool"],
  "invalid-minimum-over-100.json": ["minimum.fiveHour"],
  "invalid-pool-of-other-agent.json": ["accounts.0.pool"],
  "invalid-proto-pool.json": ["pools.claude.__proto__"],
  "invalid-relative-home.json": ["accounts.0.home"],
  "invalid-token.json": ["accounts.0.token"],
};

describe("golden corpus of account registries: valid files are also in their written form", async () => {
  for (const [version, name, text] of await corpus("AccountRegistry")) {
    test(`${version}/${name}`, () => {
      const read = readDocument(AccountRegistry, ACCOUNTS_SCHEMA_VERSION, JSON.parse(text));
      expect(read.ok ? undefined : read.finding.code).toBe(expectedCode(version, name, ACCOUNTS_SCHEMA_VERSION));
      expect(issuePaths(read)).toEqual(promisedAccounts[name] ?? []);
      expect(read.ok ? formatRegistry(read.value) : text).toBe(text);
    });
  }
});

describe("golden corpus of workflows: valid files are also in their canonical form", async () => {
  for (const [version, name, text] of await corpus("WorkflowDefinition")) {
    test(`${version}/${name}`, () => {
      const read = readDocument(WorkflowDefinition, WORKFLOW_SCHEMA_VERSION, JSON.parse(text));
      expect(read.ok ? undefined : read.finding.code).toBe(expectedCode(version, name, WORKFLOW_SCHEMA_VERSION));
      expect(issuePaths(read)).toEqual(promised[name] ?? []);
      expect(read.ok ? formatWorkflow(read.value) : text).toBe(text);
    });
  }
});

test("values nested deeper than 32 levels are refused before the schema runs, without overflowing the stack", () => {
  let deep: Json = "x";
  for (let level = 0; level < 2000; level += 1) deep = [deep];
  const read = readDocument(Plan, KNOWN, { schemaVersion: 1, operations: deep });
  expect([read.ok ? "" : read.finding.code, issuePaths(read)[0]?.split(".").length]).toEqual(["document.invalid", 32]);
});

// Keys in reverse order at every depth, as an editor might write them.
const reverseKeys = (value: Json): Json => {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value).flatMap(([key, item]) => (item === undefined ? [] : [[key, item] as const]));
  return Object.fromEntries(entries.toReversed().map(([key, item]) => [key, reverseKeys(item)]));
};

const id = fc.stringMatching(/^[a-z][a-z0-9-]{0,8}$/);
const name = fc.stringMatching(/^[a-z][a-z0-9_]{0,8}$/);
const workflows = fc
  .record({
    nodes: fc.uniqueArray(
      fc.record({ id, type: fc.constantFrom("command.run", "join"), with: fc.dictionary(id, fc.jsonValue()) }),
      {
        selector: (node) => node.id,
        minLength: 1,
        maxLength: 8,
      },
    ),
    edges: fc.uniqueArray(
      fc.record({ id, from: fc.record({ node: id, handle: fc.constant("done") }), to: fc.record({ output: name }) }),
      {
        selector: (edge) => edge.id,
        maxLength: 8,
      },
    ),
    layout: fc.dictionary(id, fc.record({ x: fc.integer(), y: fc.integer() })),
  })
  .map(({ nodes, edges, layout }) =>
    WorkflowDefinition.parse({
      schemaVersion: 1,
      kind: "cedarloom.workflow",
      metadata: { id: "w", name: "W", version: "1.0.0" },
      nodes,
      edges,
      layout: { nodes: layout },
    }),
  );

test("the file format depends on the workflow only, not on the order of its nodes, edges or keys, and is stable", () => {
  const reordered = workflows.chain((workflow) =>
    fc.tuple(
      fc.constant(workflow),
      fc.shuffledSubarray(workflow.nodes, { minLength: workflow.nodes.length }),
      fc.shuffledSubarray(workflow.edges, { minLength: workflow.edges.length }),
    ),
  );
  fc.assert(
    fc.property(reordered, ([workflow, nodes, edges]) => {
      const text = formatWorkflow(workflow);
      const reversed = reverseKeys({ ...workflow, nodes, edges });
      expect(formatWorkflow(WorkflowDefinition.parse(reversed))).toBe(text);
      expect(formatWorkflow(WorkflowDefinition.parse(JSON.parse(text)))).toBe(text);
    }),
  );
});

test("repeated ids, which the validator reports, still give one file whatever their order", () => {
  const twice = WorkflowDefinition.parse({
    schemaVersion: 1,
    kind: "cedarloom.workflow",
    metadata: { id: "w", name: "W", version: "1.0.0" },
    nodes: [
      { id: "a", type: "join" },
      { id: "a", type: "command.run" },
    ],
    edges: [],
  });
  expect(formatWorkflow({ ...twice, nodes: twice.nodes.toReversed() })).toBe(formatWorkflow(twice));
});

test("an invalid document names the path and code of each issue, no prose", () => {
  const read = readDocument(Plan, KNOWN, { schemaVersion: 1, operations: [{ kind: "delete", path: "", before: "x" }] });
  expect(read).toEqual({
    ok: false,
    finding: {
      code: "document.invalid",
      params: {
        issues: [
          { path: "operations.0.path", code: "invalid_format" },
          { path: "operations.0.before", code: "invalid_format" },
        ],
      },
    },
  });
});

test("a newer schemaVersion is refused before the schema runs", () => {
  expect(readDocument(Plan, KNOWN, { schemaVersion: 7 })).toEqual({
    ok: false,
    finding: { code: "document.newer-schema", params: { found: 7, known: 1 } },
  });
});

// A reader that passes a literal instead of the schema's version constant fails the typecheck once the constant moves on.
test("readDocument takes only the schema's own version as the known one", () => {
  const next = PLAN_SCHEMA_VERSION + 1;
  // @ts-expect-error a number, not the Plan schema's version
  expect(readDocument(Plan, next, { schemaVersion: next }).ok).toBe(false);
});

test("canonical JSON sorts keys at every depth, keeps array order and has no whitespace", () => {
  const a = canonicalJson({ b: [3, { y: null, x: true }], a: "é\n", "": 1 });
  expect(a).toBe('{"":1,"a":"é\\n","b":[3,{"x":true,"y":null}]}');
  expect(canonicalJson({ a: "é\n", "": 1, b: [3, { x: true, y: null }], gone: undefined })).toBe(a);
});

const path = (value: string): boolean => NODE_CONFIGS["file.read"].safeParse({ path: value }).success;

test("node configuration: five-field numeric cron, IANA time zones, paths inside the project", () => {
  const valid = ["0 3 * * *", "*/15 * * * *", "0 9-17/2 * * 1-5", "0,30 8 1 1,6 0", "59 23 31 12 6"];
  const invalid = ["", "0 3 * *", "0 3 * * * *", "60 3 * * *", "0 24 * * *", "0 3 0 * *", "0 3 * 13 *", "0 3 * * 7"];
  const more = ["0 3 * * MON", "5-1 * * * *", "*/0 * * * *", "1-2-3 * * * *", "0/5/1 * * * *", "100 * * * *"];
  // A step only after `*` or a range, as crontab(5) defines it.
  more.push("5/15 * * * *");
  expect(valid.map(isCron)).toEqual(valid.map(() => true));
  expect([...invalid, ...more].map(isCron)).toEqual([...invalid, ...more].map(() => false));
  const schedule = NODE_CONFIGS["trigger.schedule"];
  const ok = (value: object): boolean => schedule.safeParse({ cron: "0 3 * * *", precheck: "true", ...value }).success;
  expect([ok({}), ok({ timezone: "Europe/Berlin" }), ok({ timezone: "Mars/Olympus" }), ok({ precheck: "" })]).toEqual([
    true,
    true,
    false,
    false,
  ]);
  // An IANA name in its exact case: no UTC offset, no other case.
  const zones = ["UTC", "Etc/GMT+1", "EST5EDT", "GMT0", "+01:00", "europe/berlin", "Europe/berlin"];
  expect(zones.map((timezone) => ok({ timezone }))).toEqual([true, true, true, true, false, false, false]);
  const inside = ["notes/a.md", "a/..b", "...", ".github/x.yml"];
  const outside = ["/etc/hosts", "C:/x", "c:x", "../a", "a/../b", "a/..", "a\\b", "\\server\\x", ""];
  // A line break or a space before `/..` must not hide a step out of the project; control characters are refused.
  outside.push(
    "\n/../../etc/hosts",
    "x\n/../../../etc",
    "a/\r/../../../x",
    " /../../x",
    "a\u2028/../../x",
    "a\u0000b",
    "a\tb",
  );
  expect(inside.map(path)).toEqual(inside.map(() => true));
  expect(outside.map(path)).toEqual(outside.map(() => false));
});

test("the path pattern in the JSON Schema documents means the same without the u flag", async () => {
  const document = JSON.parse(
    await readFile(join(import.meta.dirname, "..", "schema", "FileReadConfig.schema.json"), "utf8"),
  );
  const pattern = new RegExp(String(document.properties.path.pattern));
  expect(["src/package.json", "Cc/p{x}.md"].map((value) => pattern.test(value))).toEqual([true, true]);
  expect(["../a", "a/\n/../../x", "/etc/hosts"].map((value) => pattern.test(value))).toEqual([false, false, false]);
});
