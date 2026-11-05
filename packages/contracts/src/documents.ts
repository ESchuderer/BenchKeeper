import { z } from "zod";
import type { Finding } from "./findings.ts";
import { SchemaVersion } from "./registry.ts";

/** A value, or the finding that explains why there is none. */
export type Result<T> = { ok: true; value: T } | { ok: false; finding: Finding };

/** How deep a document's values may nest; deeper values would overflow the stack of a recursive schema check. */
const MAX_DEPTH = 32;

/**
 * The path of the first value nested deeper than MAX_DEPTH, and the path of every own `__proto__` key, which a zod
 * record drops without an issue while the JSON Schema refuses it; walks without recursion.
 */
const walk = (value: unknown): { deep: string | undefined; proto: string[] } => {
  const proto: string[] = [];
  const stack: [unknown, string[]][] = [[value, []]];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    const [item, path] = next;
    if (typeof item !== "object" || item === null) continue;
    if (path.length >= MAX_DEPTH) return { deep: path.join("."), proto };
    if (Object.hasOwn(item, "__proto__")) proto.push([...path, "__proto__"].join("."));
    for (const [key, child] of Object.entries(item)) stack.push([child, [...path, key]]);
  }
  return { deep: undefined, proto };
};

/**
 * Validates a persisted document: a `schemaVersion` above `known`, values nested deeper than 32 levels and `__proto__`
 * keys are refused before the schema is applied.
 */
export const readDocument = <T>(schema: z.ZodType<T>, known: number, value: unknown): Result<T> => {
  const head = z.looseObject({ schemaVersion: SchemaVersion }).safeParse(value);
  if (head.success && head.data.schemaVersion > known) {
    return { ok: false, finding: { code: "document.newer-schema", params: { found: head.data.schemaVersion, known } } };
  }
  const { deep, proto } = walk(value);
  if (deep !== undefined) {
    return { ok: false, finding: { code: "document.invalid", params: { issues: [{ path: deep, code: "too_deep" }] } } };
  }
  if (proto.length > 0) {
    const issues = proto.map((path) => ({ path, code: "unrecognized_keys" }));
    return { ok: false, finding: { code: "document.invalid", params: { issues } } };
  }
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data };
  // An unknown key is one issue per key, at the key's own path, so the reader learns which key to remove.
  const issues = parsed.error.issues.flatMap((issue) =>
    (issue.code === "unrecognized_keys" ? issue.keys.map((key) => [...issue.path, key]) : [issue.path]).map((path) => ({
      path: path.join("."),
      code: issue.code,
    })),
  );
  return { ok: false, finding: { code: "document.invalid", params: { issues } } };
};
