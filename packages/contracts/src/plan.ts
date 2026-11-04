import { z } from "zod";
import { contracts } from "./registry.ts";

/** Lowercase hex SHA-256 of a file's bytes. */
export const Sha256 = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .register(contracts, { id: "Sha256" });

// No node:path in the contracts: a plan written on one system names the paths of another (POSIX, drive letter or UNC).
const path = z
  .string()
  .regex(/^(\/|[A-Za-z]:[\\/]|\\\\)/)
  .describe("Absolute path of the file: POSIX, drive letter or UNC");

/** Creates or replaces a UTF-8 text file. */
export const WriteFile = z
  .strictObject({
    kind: z.literal("write"),
    path,
    before: Sha256.nullable().describe("Hash the file must have when the plan applies; null: the file must not exist"),
    content: z.string(),
    mode: z
      .int()
      .min(0)
      .max(0o777)
      .optional()
      .describe("Permission bits of a file the write creates; a replaced file keeps its own"),
  })
  .register(contracts, { id: "WriteFile" });

/** Removes a file. */
export const DeleteFile = z
  .strictObject({ kind: z.literal("delete"), path, before: Sha256 })
  .register(contracts, { id: "DeleteFile" });

export const Operation = z.discriminatedUnion("kind", [WriteFile, DeleteFile]).register(contracts, { id: "Operation" });
export type Operation = z.infer<typeof Operation>;

/** The plan format this CedarLoom writes and reads; readers refuse a newer one. */
export const PLAN_SCHEMA_VERSION = 1;

/** A reviewable change: applied as approved, identified by the hash of its canonical JSON. */
export const Plan = z
  .strictObject({ schemaVersion: z.literal(PLAN_SCHEMA_VERSION), operations: z.array(Operation).min(1) })
  .register(contracts, { id: "Plan" });
export type Plan = z.infer<typeof Plan>;
