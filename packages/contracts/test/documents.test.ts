import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { SchemaVersion } from "@cedarloom/contracts";
import { documents } from "../scripts/documents.ts";

const root = join(import.meta.dirname, "..");

test("the committed JSON Schema documents are the ones the contracts generate (pnpm --filter @cedarloom/contracts generate)", async () => {
  const paths = (await readdir(join(root, "schema"))).map((name) => `schema/${name}`);
  const committed = await Promise.all(paths.map(async (path) => [path, await readFile(join(root, path), "utf8")]));
  expect(Object.fromEntries(committed)).toEqual(Object.fromEntries(documents()));
});

test("a schema version is a positive integer", () => {
  expect(SchemaVersion.safeParse(1).success).toBe(true);
  for (const bad of [0, -1, 1.5, "1"]) expect(SchemaVersion.safeParse(bad).success).toBe(false);
});
