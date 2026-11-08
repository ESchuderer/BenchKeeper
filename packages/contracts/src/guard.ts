import { z } from "zod";
import { fileFormats } from "./registry.ts";

/** The guard policy format this CedarLoom writes and reads; the guard refuses every call under another one. */
export const GUARD_SCHEMA_VERSION = 1;

/** A GitHub repository as `owner/name`; `.` and `..` are no repository, so no name climbs an API path. */
export const RepoName = z.string().regex(/^[A-Za-z0-9-]{1,39}\/(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/);

/**
 * What the guard hook of a session allows on GitHub (A13): the repositories of its access profiles (null: no limit, as
 * for an interactive session on the owner's login, ARW1-6), the hub, the only repository for issue commands, and the
 * memory repository, whose `main` no push may update (A14). The hub and the memory repository come from local config
 * and are never named in CedarLoom (ARW1-2). Merges follow the automation level (owner, 2026-11-08).
 */
export const GuardPolicy = z
  .strictObject({
    schemaVersion: z.literal(GUARD_SCHEMA_VERSION),
    repositories: z
      .union([z.array(RepoName), z.literal("origin")])
      .nullable()
      .describe("origin: the repositories of the working folder's origin, read when the hook runs"),
    hub: RepoName.nullable(),
    memory: RepoName.nullable(),
    merge: z
      .enum(["refuse", "workflow"])
      .optional()
      .describe(
        "workflow (Auto): a merge from an agent of a workflow script, which a stage reaches only after its reviewer agreed; refuse when absent",
      ),
  })
  .register(fileFormats, { id: "GuardPolicy" });
export type GuardPolicy = z.infer<typeof GuardPolicy>;
