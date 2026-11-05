import { z } from "zod";
import { AbsolutePath } from "./plan.ts";
import { fileFormats } from "./registry.ts";

/** The account registry format this CedarLoom writes and reads; readers refuse a newer one. */
export const ACCOUNTS_SCHEMA_VERSION = 1;

/** The agents whose accounts the registry holds. */
export const Agent = z.enum(["claude", "codex"]);
export type Agent = z.infer<typeof Agent>;

// BenchKeeper's rule for account and pool names, so its names import unchanged.
const Name = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/);

const Percent = z.number().min(0).max(100);

/** The headroom a launch needs in each usage window, in percent of the window. */
const Minimums = z.strictObject({ fiveHour: Percent, sevenDay: Percent });

const Account = z.strictObject({
  name: Name,
  agent: Agent,
  label: z.string().max(80).optional(),
  home: AbsolutePath.describe("The account's config folder (CLAUDE_CONFIG_DIR or CODEX_HOME); its login stays there"),
  pool: Name.nullable(),
  minimum: Minimums.partial().optional().describe("The account's own minimums, in place of the registry's"),
  added: z.iso.datetime(),
});

const Pool = z.strictObject({
  confirmedAt: z.iso
    .datetime()
    .nullable()
    .describe(
      "When the user confirmed that one person holds and pays for every account of the pool; null: no switching",
    ),
});

/**
 * The accounts by config folder, their pools per agent and the minimums: never a credential, as every object is strict.
 * Names and folders are unique, and an account's pool is one of its agent's pools.
 */
export const AccountRegistry = z
  .strictObject({
    schemaVersion: z.literal(ACCOUNTS_SCHEMA_VERSION),
    minimum: Minimums,
    accounts: z.array(Account),
    pools: z.partialRecord(Agent, z.record(Name, Pool)),
  })
  .superRefine((registry, ctx) => {
    // shortcut: folders compare as written, so a trailing slash or other case passes; normalize once an edit command exists.
    const seen = { name: new Set<string>(), home: new Set<string>() };
    for (const [index, account] of registry.accounts.entries()) {
      for (const key of ["name", "home"] as const) {
        if (seen[key].has(account[key])) {
          ctx.addIssue({ code: "custom", path: ["accounts", index, key], message: "taken" });
        }
        seen[key].add(account[key]);
      }
      // Own keys only: a pool named like an inherited property (constructor, tostring) must not pass as declared.
      if (account.pool !== null && !Object.hasOwn(registry.pools[account.agent] ?? {}, account.pool)) {
        ctx.addIssue({
          code: "custom",
          path: ["accounts", index, "pool"],
          message: "not a pool of the account's agent",
        });
      }
    }
  })
  .register(fileFormats, { id: "AccountRegistry" });
export type AccountRegistry = z.infer<typeof AccountRegistry>;
export type Account = AccountRegistry["accounts"][number];
