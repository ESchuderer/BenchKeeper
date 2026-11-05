import { z } from "zod";
import type { Finding } from "./findings.ts";
import { SchemaVersion } from "./registry.ts";

/** A value, or the finding that explains why there is none. */
export type Result<T> = { ok: true; value: T } | { ok: false; finding: Finding };

/** Validates a persisted document; a `schemaVersion` above `known` is refused before the schema is applied. */
export const readDocument = <T>(schema: z.ZodType<T>, known: number, value: unknown): Result<T> => {
  const head = z.looseObject({ schemaVersion: SchemaVersion }).safeParse(value);
  if (head.success && head.data.schemaVersion > known) {
    return { ok: false, finding: { code: "document.newer-schema", params: { found: head.data.schemaVersion, known } } };
  }
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issues = parsed.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code }));
  return { ok: false, finding: { code: "document.invalid", params: { issues } } };
};
