import { createHash } from "node:crypto";
import { canonicalJson, type Plan } from "@cedarloom/contracts";

export const sha256 = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");

/** The plan's identity: SHA-256 of its canonical JSON, equal for equal plans on every run and machine. */
export const planHash = (plan: Plan): string => sha256(canonicalJson(plan));
