import { z } from "zod";
import { fileFormats } from "./registry.ts";

/** The guard policy format this CedarLoom writes and reads; the guard refuses every call under another one. */
export const GUARD_SCHEMA_VERSION = 1;

/** A GitHub repository as `owner/name`; `.` and `..` are no repository, so no name climbs an API path. */
export const RepoName = z.string().regex(/^[A-Za-z0-9-]{1,39}\/(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/);

/**
 * What a workflow package's guard hook allows a workflow's own agents on GitHub (A13): the working folder's origin, the
 * hub, the only repository for issue commands, and the memory repository, whose `main` no push may update (A14). The
 * hub and the memory repository come from local config and are never named in CedarLoom (ARW1-2). Merges follow the
 * automation level (owner, 2026-11-08); any other caller runs untouched (owner, 2026-11-09).
 */
export const GuardPolicy = z
  .strictObject({
    schemaVersion: z.literal(GUARD_SCHEMA_VERSION),
    hub: RepoName.nullable(),
    memory: RepoName.nullable(),
    merge: z
      .enum(["refuse", "workflow"])
      .optional()
      .describe(
        "workflow (Auto): a merge from an agent of a workflow script, which a stage reaches only after its reviewer agreed; refuse when absent",
      ),
    plugin: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .describe("The package's plugin, whose steps' own subagents (<plugin>:<step>) meet the guard"),
  })
  .register(fileFormats, { id: "GuardPolicy" });
export type GuardPolicy = z.infer<typeof GuardPolicy>;

/** A repository binding as a policy holds it: one it cannot hold, such as owner/., counts as none. */
export const heldRepo = (repo: string | null | undefined): string | null =>
  repo !== null && repo !== undefined && RepoName.safeParse(repo).success ? repo : null;
