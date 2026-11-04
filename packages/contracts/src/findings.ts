import { z } from "zod";
import { contracts, SchemaVersion } from "./registry.ts";

const finding = <const C extends string, const P extends z.ZodRawShape>(code: C, params: P) =>
  z.strictObject({ code: z.literal(code), params: z.strictObject(params) });

/** A result of a check: a code and typed parameters; the text for people comes from the message catalog. */
export const Finding = z
  .discriminatedUnion("code", [
    finding("document.newer-schema", { found: SchemaVersion, known: SchemaVersion }),
    finding("document.invalid", { issues: z.array(z.strictObject({ path: z.string(), code: z.string() })) }),
  ])
  .register(contracts, { id: "Finding" });
export type Finding = z.infer<typeof Finding>;
export type FindingCode = Finding["code"];

interface FindingInfo {
  severity: "error" | "warning" | "info";
  /** `command`: a CedarLoom command fixes it; `manual`: the user acts. */
  effort: "command" | "manual";
}

export const findingInfo: Record<FindingCode, FindingInfo> = {
  "document.newer-schema": { severity: "error", effort: "manual" },
  "document.invalid": { severity: "error", effort: "manual" },
};
