import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, Plan, readDocument } from "@cedarloom/contracts";
import { describe, expect, test } from "vitest";

const corpus = join(import.meta.dirname, "..", "corpus", "Plan");
const KNOWN = 1;

const expectedCode = (version: string, name: string): string | undefined => {
  if (Number(version) > KNOWN) return "document.newer-schema";
  return name.startsWith("valid-") ? undefined : "document.invalid";
};

describe("golden corpus of plans, one folder per schemaVersion", async () => {
  for (const version of await readdir(corpus)) {
    for (const name of await readdir(join(corpus, version))) {
      test(`${version}/${name}`, async () => {
        const read = readDocument(Plan, KNOWN, JSON.parse(await readFile(join(corpus, version, name), "utf8")));
        expect(read.ok ? undefined : read.finding.code).toBe(expectedCode(version, name));
      });
    }
  }
});

test("an invalid document names the path and code of each issue, no prose", () => {
  const read = readDocument(Plan, KNOWN, { schemaVersion: 1, operations: [{ kind: "delete", path: "", before: "x" }] });
  expect(read).toEqual({
    ok: false,
    finding: {
      code: "document.invalid",
      params: {
        issues: [
          { path: "operations.0.path", code: "too_small" },
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
  expect(canonicalJson({ a: "é\n", "": 1, b: [3, { x: true, y: null }] })).toBe(a);
});
