import { ACCOUNTS_SCHEMA_VERSION, AccountRegistry, Agent, readDocument, type Result } from "@cedarloom/contracts";
import { z } from "zod";

/** The starting minimums: 8 percent of the 5-hour window and 3 percent of the 7-day window, until the user sets others. */
export const DEFAULT_MINIMUM = { fiveHour: 8, sevenDay: 3 } as const;

const Windows = z.looseObject({ fiveHour: z.number().optional(), sevenDay: z.number().optional() });

// BenchKeeper's accounts.json as far as the import reads it; the registry check below refuses anything else it cannot hold.
const BenchKeeperAccount = z.looseObject({
  name: z.string(),
  agent: Agent,
  label: z.string().optional(),
  mode: z.enum(["host", "container"]),
  dir: z.string().optional(),
  pool: z.string().optional(),
  limits: z.looseObject({ minimum: Windows.optional(), warn: Windows.optional() }).optional(),
  added: z.string().optional(),
  default: z.boolean().optional(),
  token: z.looseObject({}).nullable().optional(),
});
type BenchKeeperAccount = z.infer<typeof BenchKeeperAccount>;

const BenchKeeperFile = z.looseObject({
  accounts: z.array(BenchKeeperAccount),
  settings: z.looseObject({ minimum: Windows.optional() }).optional(),
});

const SETTINGS_LEFT = ["warn", "autoPick", "whenNone", "continueBelow", "rotate"] as const;

/** What the import leaves in BenchKeeper: an account without a host folder, a stored token, or a setting CedarLoom lacks. */
export interface Left {
  /** null: one of BenchKeeper's settings. */
  readonly account: string | null;
  readonly item: (typeof SETTINGS_LEFT)[number] | "container-account" | "token" | "default";
}

export interface Imported {
  readonly registry: AccountRegistry;
  readonly left: readonly Left[];
}

const leftOf = (account: BenchKeeperAccount): Left[] =>
  (
    [
      ["container-account", account.mode === "container"],
      ["token", account.token != null],
      ["default", account.default === true],
      ["warn", account.limits?.warn !== undefined],
    ] as const
  )
    .filter(([, left]) => left)
    .map(([item]) => ({ account: account.name, item }));

const toAccount = (account: BenchKeeperAccount, now: string) => ({
  name: account.name,
  agent: account.agent,
  ...(account.label === undefined ? {} : { label: account.label }),
  home: account.dir,
  pool: account.pool ?? null,
  ...(account.limits?.minimum === undefined ? {} : { minimum: account.limits.minimum }),
  added: account.added ?? now,
});

/**
 * Maps BenchKeeper's registry file to CedarLoom's: its host accounts with pools per agent, its minimums, and the list of
 * what stays behind. Pools start unconfirmed (owner, 2026-11-05). `now` dates an account BenchKeeper did not date.
 */
export const importBenchKeeper = (value: unknown, now: string): Result<Imported> => {
  // BenchKeeper's file has no schemaVersion, so no version is newer than the one known.
  const file = readDocument(BenchKeeperFile, Number.POSITIVE_INFINITY, value);
  if (!file.ok) return file;
  const { accounts, settings } = file.value;
  const host = accounts.filter((account) => account.mode === "host");
  const pools: Partial<Record<Agent, Record<string, { confirmedAt: null }>>> = {};
  for (const { agent, pool } of host) {
    if (pool !== undefined) pools[agent] = { ...pools[agent], [pool]: { confirmedAt: null } };
  }
  const registry = readDocument(AccountRegistry, ACCOUNTS_SCHEMA_VERSION, {
    schemaVersion: ACCOUNTS_SCHEMA_VERSION,
    minimum: { ...DEFAULT_MINIMUM, ...settings?.minimum },
    accounts: host.map((account) => toAccount(account, now)),
    pools,
  });
  if (!registry.ok) return registry;
  const left: Left[] = [
    ...SETTINGS_LEFT.filter((key) => settings?.[key] !== undefined).map((item) => ({ account: null, item })),
    ...accounts.flatMap(leftOf),
  ];
  return { ok: true, value: { registry: registry.value, left } };
};
