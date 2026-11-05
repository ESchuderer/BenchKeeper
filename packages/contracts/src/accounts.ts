import { z } from "zod";
import { sortKeys } from "./json.ts";
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
  confirmedFor: z
    .array(Name)
    .describe("The accounts the confirmation named; once the pool's accounts differ, it counts as unconfirmed"),
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
      // Own keys only: a pool named constructor, the one inherited property the name rule admits, is not declared.
      if (account.pool !== null && !Object.hasOwn(registry.pools[account.agent] ?? {}, account.pool)) {
        ctx.addIssue({
          code: "custom",
          path: ["accounts", index, "pool"],
          message: "not a pool of the account's agent",
        });
      }
    }
  })
  .superRefine((registry, ctx) => {
    // Codex switching stays off (A40): no Codex pool is confirmed in format 1; lifting that loosens the format later.
    for (const [name, pool] of Object.entries(registry.pools.codex ?? {})) {
      if (pool.confirmedAt !== null) {
        ctx.addIssue({
          code: "custom",
          path: ["pools", "codex", name, "confirmedAt"],
          message: "Codex switching is off",
        });
      }
    }
  })
  .register(fileFormats, { id: "AccountRegistry" });
export type AccountRegistry = z.infer<typeof AccountRegistry>;
export type Account = AccountRegistry["accounts"][number];

/** The registry file's text: keys in schema order, pools sorted by name, two-space indentation. */
export const formatRegistry = (registry: AccountRegistry): string =>
  `${JSON.stringify(AccountRegistry.parse(sortKeys(registry)), null, 2)}\n`;

/** The usage windows of the agent-neutral quota model. */
export const QuotaWindow = z.enum(["fiveHour", "sevenDay"]);

/** The latest reading of one usage window of an account: the used share in percent, the window's reset, the time read. */
export const Reading = z.strictObject({
  account: Name,
  window: QuotaWindow,
  usedPercent: z.number(),
  resetsAt: z.iso.datetime(),
  readAt: z.iso.datetime(),
});
export type Reading = z.infer<typeof Reading>;

/**
 * One launch-time account choice, as the ledger keeps it: the task, the account it last ran on (null on its first
 * launch), the account chosen, the pool's readings and each candidate's margin above its minimums.
 */
export const AccountSwitch = z.strictObject({
  at: z.iso.datetime(),
  task: z.string(),
  from: Name.nullable(),
  to: Name,
  readings: z.array(Reading),
  candidates: z.array(z.strictObject({ account: Name, margin: z.number().nullable() })),
});
export type AccountSwitch = z.infer<typeof AccountSwitch>;
