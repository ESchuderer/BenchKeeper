import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";

const root = join(import.meta.dirname, "..");

/**
 * Every published document, so the formats' references resolve; strict mode refuses unknown keywords. The date-time
 * format is zod's ISO form in UTC.
 */
export const ajv = new Ajv2020({
  strict: true,
  formats: { "date-time": /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/ },
});
for (const name of await readdir(join(root, "schema"))) {
  ajv.addSchema(JSON.parse(await readFile(join(root, "schema", name), "utf8")));
}

/** Whether the published JSON Schema document of a format accepts a value. */
export const published =
  (name: string) =>
  (value: unknown): boolean =>
    ajv.getSchema(`${name}.schema.json`)?.(value) === true;

/** A copy of `value` with the value at `path` replaced; missing objects on the way are created. */
export const set = (value: unknown, path: (string | number)[], next: unknown): unknown => {
  const [key, ...rest] = path;
  if (key === undefined) return next;
  const copy: unknown = structuredClone(value ?? {});
  if (typeof copy !== "object" || copy === null) throw new Error(`no object at ${key}`);
  return Object.assign(copy, { [key]: set(Reflect.get(copy, key), rest, next) });
};
