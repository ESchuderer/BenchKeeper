import { z } from "zod";
import { sortKeys } from "./json.ts";
import { AbsolutePath } from "./plan.ts";
import { fileFormats } from "./registry.ts";

/** The account registry format this CedarLoom writes and reads; readers refuse a newer one. */
export const ACCOUNTS_SCHEMA_VERSION = 1;

/** The agents whose accounts the registry holds. */
export const Agent = z.enum(["claude", "codex"]);

/**
 * An agent CLI version as its `--version` output and its session lines report it, such as `2.1.316`. The form is
 * bounded, so a CLI cannot put a long or escaped string into the ledger or onto a screen that shows it.
 */
export const AgentVersion = z.string().regex(/^\d{1,9}\.\d{1,9}\.\d{1,9}[0-9A-Za-z.+-]{0,40}$/);
export type Agent = z.infer<typeof Agent>;

// Account and pool names: a lowercase letter or digit, then up to 31 more of them, - or _.
const Name = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/);

/** An account's name: also safe as a file name. */
export const AccountName = Name;

// A share in percent, 0 to 100 (A71): an adapter converts its agent's own form at the boundary.
const Percent = z.number().min(0).max(100);

const Account = z.strictObject({
  name: Name,
  agent: Agent,
  label: z.string().max(80).optional(),
  home: AbsolutePath.describe("The account's config folder (CLAUDE_CONFIG_DIR or CODEX_HOME); its login stays there"),
  aliases: z
    .array(AbsolutePath)
    .optional()
    .describe(
      "Earlier and other config folders of the same account; workers may not read them, and nothing reads or writes them",
    ),
  pool: Name.nullable(),
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
  moveRunning: z
    .boolean()
    .optional()
    .describe("Whether running workers move to another account of the pool at their line or limit; off when unset"),
});

// A folder as the registry compares it: without trailing separators, so `/a/b/` is `/a/b`.
const folderKey = (path: string): string => {
  let end = path.length;
  while (end > 1 && (path[end - 1] === "/" || path[end - 1] === "\\")) end -= 1;
  return path.slice(0, end);
};

/** Whether two registry folders are the same, as the registry's uniqueness check compares them. */
export const sameFolder = (a: string, b: string): boolean => folderKey(a) === folderKey(b);

// An account's folders with their paths in the registry: its home, then its aliases.
const folders = (account: z.infer<typeof Account>, index: number): [string, (string | number)[]][] => [
  [account.home, ["accounts", index, "home"]],
  ...(account.aliases ?? []).map((alias, at): [string, (string | number)[]] => [
    alias,
    ["accounts", index, "aliases", at],
  ]),
];

/**
 * The accounts by config folder and their pools per agent: never a credential, as every object is strict.
 * Names and folders, homes and aliases alike, are unique, and an account's pool is one of its agent's pools.
 */
export const AccountRegistry = z
  .strictObject({
    schemaVersion: z.literal(ACCOUNTS_SCHEMA_VERSION),
    accounts: z.array(Account),
    pools: z.partialRecord(Agent, z.record(Name, Pool)),
  })
  .superRefine((registry, ctx) => {
    // shortcut: folders compare without a trailing separator, else as written; compare real paths once others come.
    const names = new Set<string>();
    const taken = new Set<string>();
    const claim = (seen: Set<string>, value: string, path: (string | number)[]) => {
      if (seen.has(value)) ctx.addIssue({ code: "custom", path, message: "taken" });
      seen.add(value);
    };
    for (const [index, account] of registry.accounts.entries()) {
      claim(names, account.name, ["accounts", index, "name"]);
      for (const [folder, path] of folders(account, index)) claim(taken, folderKey(folder), path);
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

/** The usage windows every account has, of the agent-neutral quota model. */
export const QuotaWindow = z.enum(["fiveHour", "sevenDay"]);
export type QuotaWindow = z.infer<typeof QuotaWindow>;

/**
 * A usage window: one every account has, or a model's own weekly window, `sevenDay:<model family>`, which only some
 * accounts have.
 */
export const Quota = z.union([QuotaWindow, z.string().regex(/^sevenDay:[a-z]{1,20}$/)]);
export type Quota = z.infer<typeof Quota>;

/** A model's own weekly window, such as `sevenDay:opus` for claude-opus-5-5; null for an ID without a model family. */
export const modelWindow = (model: string): Quota | null => {
  const family = /^claude-([a-z]{1,20})-/.exec(model)?.[1];
  return family === undefined ? null : `sevenDay:${family}`;
};

/**
 * The latest reading of one usage window of an account: the used share in percent, the window's reset, the time read,
 * and who read it: a worker's own session (`worker`) or claude-swap's usage report (`cswap`).
 */
export const Reading = z.strictObject({
  account: Name,
  window: Quota,
  usedPercent: Percent,
  // Milliseconds, so the ledger's text order is time order; null: a share without a reset, kept until the next reading.
  resetsAt: z.iso.datetime({ precision: 3 }).nullable(),
  readAt: z.iso.datetime({ precision: 3 }),
  source: z.enum(["worker", "cswap"]),
});
export type Reading = z.infer<typeof Reading>;

/** The most of an agent's own line a usage sample keeps, in bytes; a longer line is cut and marked. */
export const USAGE_RAW_LIMIT_BYTES = 16 * 1024;

/** Ends a usage sample's line that was cut at USAGE_RAW_LIMIT_BYTES. */
export const USAGE_RAW_CUT_MARKER = "…[cut]";

/**
 * One usage window as a session reported it, kept as history (A84): the agent's own window name and line, its CLI
 * version, and the run it came from. Windows without a quota name, a share or a reset are kept too.
 */
export const UsageSample = z.strictObject({
  account: Name,
  agent: Agent,
  agentVersion: AgentVersion,
  window: z.string().min(1).max(64),
  quota: Quota.nullable(),
  usedPercent: Percent.nullable(),
  resetsAt: z.iso.datetime({ precision: 3 }).nullable(),
  readAt: z.iso.datetime({ precision: 3 }),
  runId: z.uuid().nullable(),
  // Canonical JSON; a line over USAGE_RAW_LIMIT_BYTES keeps its start plus USAGE_RAW_CUT_MARKER, and is then no JSON.
  raw: z.string(),
});
export type UsageSample = z.infer<typeof UsageSample>;

/**
 * One launch-time account choice, as the ledger keeps it: the task, the account it last ran on (null on its first
 * launch), the account chosen and why, the pool's readings the choice counted and each candidate's margin above its
 * minimums.
 */
export const AccountSwitch = z.strictObject({
  at: z.iso.datetime({ precision: 3 }),
  task: z.string(),
  from: Name.nullable(),
  to: Name,
  reason: z.enum(["most-headroom", "soonest-weekly-reset", "highest-tier", "no-readings"]),
  // `launch`: a new worker's choice; `line` and `at-limit`: a running worker's move.
  trigger: z.enum(["launch", "line", "at-limit"]),
  readings: z.array(Reading),
  candidates: z.array(z.strictObject({ account: Name, margin: z.number().nullable() })),
});
export type AccountSwitch = z.infer<typeof AccountSwitch>;

/**
 * The contract check of one agent CLI version, as the ledger keeps it: the parts of the output the probe lacked, none
 * when it passed. Undocumented readings such as usage are read only on versions whose check passed.
 */
export const ContractCheckRecord = z.strictObject({
  agent: Agent,
  version: AgentVersion,
  missing: z.array(z.enum(["init", "settings", "usage", "result"])),
  at: z.iso.datetime({ precision: 3 }),
});
export type ContractCheckRecord = z.infer<typeof ContractCheckRecord>;
