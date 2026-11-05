import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  canonicalJson,
  formatWorkflow,
  Plan,
  readDocument,
  WORKFLOW_SCHEMA_VERSION,
  WorkflowDefinition,
} from "@cedarloom/contracts";
import * as fc from "fast-check";
import { describe, expect, test } from "vitest";

const KNOWN = 1;

const expectedCode = (version: string, name: string, known = KNOWN): string | undefined => {
  if (Number(version) > known) return "document.newer-schema";
  return name.startsWith("valid-") ? undefined : "document.invalid";
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

describe("golden corpus of workflows: valid files are also in their canonical form", async () => {
  for (const [version, name, text] of await corpus("WorkflowDefinition")) {
    test(`${version}/${name}`, () => {
      const read = readDocument(WorkflowDefinition, WORKFLOW_SCHEMA_VERSION, JSON.parse(text));
      expect(read.ok ? undefined : read.finding.code).toBe(expectedCode(version, name, WORKFLOW_SCHEMA_VERSION));
      expect(read.ok ? formatWorkflow(read.value) : text).toBe(text);
    });
  }
});

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
      // Keys in reverse order, as an editor might write them.
      const reversed = Object.fromEntries(Object.entries({ ...workflow, nodes, edges }).toReversed());
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

test("canonical JSON sorts keys at every depth, keeps array order and has no whitespace", () => {
  const a = canonicalJson({ b: [3, { y: null, x: true }], a: "é\n", "": 1 });
  expect(a).toBe('{"":1,"a":"é\\n","b":[3,{"x":true,"y":null}]}');
  expect(canonicalJson({ a: "é\n", "": 1, b: [3, { x: true, y: null }], gone: undefined })).toBe(a);
});
