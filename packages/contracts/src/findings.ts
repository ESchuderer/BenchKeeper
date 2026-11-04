import { z } from "zod";
import { Sha256 } from "./plan.ts";
import { contracts, SchemaVersion } from "./registry.ts";

const finding = <const C extends string, const P extends z.ZodRawShape>(code: C, params: P) =>
  z.strictObject({ code: z.literal(code), params: z.strictObject(params) });

/** A result of a check: a code and typed parameters; the text for people comes from the message catalog. */
export const Finding = z
  .discriminatedUnion("code", [
    finding("document.newer-schema", { found: SchemaVersion, known: SchemaVersion }),
    finding("document.invalid", { issues: z.array(z.strictObject({ path: z.string(), code: z.string() })) }),
    finding("plan.not-approved", { planHash: Sha256, approvedHash: z.string() }),
    finding("store.busy", { dir: z.string() }),
    finding("store.network-filesystem", { dir: z.string(), fsType: z.string() }),
    finding("store.newer-schema", { found: z.int(), known: z.int() }),
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
  "plan.not-approved": { severity: "error", effort: "command" },
  "store.busy": { severity: "error", effort: "manual" },
  "store.network-filesystem": { severity: "error", effort: "manual" },
  "store.newer-schema": { severity: "error", effort: "manual" },
};
