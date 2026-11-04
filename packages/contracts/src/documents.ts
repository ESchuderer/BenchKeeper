import { z } from "zod";
import type { Finding } from "./findings.ts";
import { SchemaVersion } from "./registry.ts";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** JSON with object keys sorted by UTF-16 code units and no whitespace: equal values give equal text (RFC 8785 for the values CedarLoom stores). */
export const canonicalJson = (value: Json): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const entries = Object.entries(value).toSorted(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
};

export type Read<T> = { ok: true; value: T } | { ok: false; finding: Finding };

/** Validates a persisted document; a `schemaVersion` above `known` is refused before the schema is applied. */
export const readDocument = <T>(schema: z.ZodType<T>, known: number, value: unknown): Read<T> => {
  const head = z.looseObject({ schemaVersion: SchemaVersion }).safeParse(value);
  if (head.success && head.data.schemaVersion > known) {
    return { ok: false, finding: { code: "document.newer-schema", params: { found: head.data.schemaVersion, known } } };
  }
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issues = parsed.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code }));
  return { ok: false, finding: { code: "document.invalid", params: { issues } } };
};
