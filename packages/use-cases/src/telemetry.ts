import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import {
  AgentVersion,
  formatTelemetryTokens,
  type Operation,
  type Plan,
  type Result,
  readDocument,
  TELEMETRY_PORT,
  TELEMETRY_TOKENS_SCHEMA_VERSION,
  TelemetryTokens,
  TokenRow,
} from "@cedarloom/contracts";
import { sha256 } from "@cedarloom/ledger";
import { z } from "zod";
import { loadRegistry } from "./accounts.ts";
import { readOptionalJson, retryBusy, withStore } from "./use-cases.ts";

/** The run and account a receiver token stands for; no run for an interactive home's. */
export type TelemetryRun = Pick<TokenRow, "runId" | "account">;

/**
 * The loopback receiver of OpenTelemetry logs (OTLP over http/json). Each worker run posts with a token of its own,
 * which names its run and account, so a worker cannot post for another run; an interactive home posts with its
 * account's token from `accounts telemetry`.
 */
export interface TelemetryReceiver {
  /** The logs endpoint, `http://127.0.0.1:<port>/v1/logs`. */
  readonly endpoint: string;
  /** A fresh bearer token whose posts count for `run` until it is released. */
  register(run: TelemetryRun): string;
  release(token: string): void;
  close(): Promise<void>;
}

// OTLP's JSON encoding: an attribute value is one of these, and an int64 may come as a string
// (https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding).
const Value = z.looseObject({
  stringValue: z.string().optional(),
  intValue: z.union([z.number(), z.string()]).optional(),
  doubleValue: z.number().optional(),
});
const Attribute = z.looseObject({ key: z.string(), value: Value });
const LogRecord = z.looseObject({ attributes: z.array(z.unknown()) });
const Scope = z.looseObject({ logRecords: z.array(z.unknown()) });
const Resource = z.looseObject({ scopeLogs: z.array(z.unknown()) });
const Logs = z.looseObject({ resourceLogs: z.array(z.unknown()) });

// The entries of `list` that `schema` takes. Each level of a batch is read on its own, so an odd entry (a value of
// another shape, a resource without scopes) gives no row but never costs its siblings theirs: the exporter does not
// send a batch again that was answered 200.
const parsedEach = <T>(list: readonly unknown[], schema: z.ZodType<T>): T[] =>
  list.flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });

type Values = ReadonlyMap<string, string | number>;

const valuesOf = (attributes: readonly z.infer<typeof Attribute>[]): Values =>
  new Map(
    attributes.flatMap(({ key, value }) => {
      const raw = value.stringValue ?? value.intValue ?? value.doubleValue;
      return raw === undefined ? [] : [[key, raw] as const];
    }),
  );

const stringOf = (values: Values, key: string): string | null => {
  const value = values.get(key);
  return typeof value === "string" ? value : null;
};

const count = (values: Values, key: string): number | null => {
  const raw = values.get(key);
  // An int64 may come as a string of digits; Number would read "" or " " as 0.
  const value = typeof raw === "string" && /^\d{1,16}$/.test(raw) ? Number(raw) : raw;
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
};

// One api_request record as a token row, or null when it is none; only the fields of the allowlist are read.
const rowOf = (values: Values, run: TelemetryRun): TokenRow | null => {
  if (stringOf(values, "event.name") !== "api_request") return null;
  const at = Date.parse(stringOf(values, "event.timestamp") ?? "");
  const version = AgentVersion.safeParse(stringOf(values, "app.version"));
  const row = TokenRow.safeParse({
    ...run,
    sessionId: stringOf(values, "session.id"),
    model: stringOf(values, "model"),
    querySource: stringOf(values, "query_source"),
    effort: stringOf(values, "effort"),
    inputTokens: count(values, "input_tokens"),
    outputTokens: count(values, "output_tokens"),
    cacheReadTokens: count(values, "cache_read_tokens"),
    cacheCreationTokens: count(values, "cache_creation_tokens"),
    cacheCreation5mTokens: count(values, "cache_creation_5m_tokens") ?? 0,
    cacheCreation1hTokens: count(values, "cache_creation_1h_tokens") ?? 0,
    costUsdMicros: count(values, "cost_usd_micros"),
    durationMs: count(values, "duration_ms"),
    requestId: stringOf(values, "request_id"),
    agentVersion: version.success ? version.data : null,
    at: Number.isNaN(at) ? null : new Date(at).toISOString(),
  });
  return row.success ? row.data : null;
};

/**
 * The token rows of an OTLP logs body for `run`: one per Claude Code `api_request` event (A84). Only the fields of the
 * allowlist are read: identity attributes such as the user's e-mail or account id never are.
 */
export const tokenRowsOf = (body: unknown, run: TelemetryRun): TokenRow[] =>
  parsedEach([body], Logs)
    .flatMap((logs) => parsedEach(logs.resourceLogs, Resource))
    .flatMap((resource) => parsedEach(resource.scopeLogs, Scope))
    .flatMap((scope) => parsedEach(scope.logRecords, LogRecord))
    .flatMap((record) => rowOf(valuesOf(parsedEach(record.attributes, Attribute)), run) ?? []);

const answer = (res: ServerResponse, status: number): void => {
  res.writeHead(status, { "content-type": "application/json" }).end("{}");
};

// The request's body up to `limit` bytes; null when it is larger, read to its end so the sender sees the answer.
const bodyOf = (req: IncomingMessage, limit: number): Promise<string | null> =>
  new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) parts.push(chunk);
    });
    req.on("end", () => resolve(size <= limit ? Buffer.concat(parts).toString("utf8") : null));
    req.on("error", reject);
  });

const json = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** The tokens file in the state folder: the hash of each account's interactive token. */
const tokensPath = (state: string): string => join(state, "telemetry.json");

const readTokens = (state: string): Result<{ text: string | null; tokens: TelemetryTokens }> => {
  const file = readOptionalJson(tokensPath(state));
  if (!file.ok) return file;
  if (file.value === null) {
    const none: TelemetryTokens = {
      schemaVersion: TELEMETRY_TOKENS_SCHEMA_VERSION,
      kind: "cedarloom.telemetry-tokens",
      accounts: {},
    };
    return { ok: true, value: { text: null, tokens: none } };
  }
  const tokens = readDocument(TelemetryTokens, TELEMETRY_TOKENS_SCHEMA_VERSION, file.value.json);
  return tokens.ok ? { ok: true, value: { text: file.value.text, tokens: tokens.value } } : tokens;
};

// An interactive home's account by its token's hash. The file is read at each miss, so a plan applied while the
// receiver runs counts at once.
const homeOf = (state: string, hash: string): TelemetryRun | null => {
  const read = readTokens(state);
  const entry = read.ok ? Object.entries(read.value.tokens.accounts).find(([, each]) => each === hash) : undefined;
  return entry === undefined ? null : { runId: null, account: entry[0] };
};

// The run a request is from, by its bearer token; null for none or an unknown one. Tokens are looked up by their hash,
// so a lookup never compares secret bytes.
const runOf = (req: IncomingMessage, runs: ReadonlyMap<string, TelemetryRun>, state: string): TelemetryRun | null => {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const hash = sha256(header.slice("Bearer ".length));
  return runs.get(hash) ?? homeOf(state, hash);
};

// The port the server listens on, on 127.0.0.1; null when it cannot listen there.
const listen = (server: Server, port: number): Promise<number | null> =>
  new Promise((resolve) => {
    server.once("error", () => resolve(null));
    server.listen(port, "127.0.0.1", () => resolve(z.object({ port: z.number() }).parse(server.address()).port));
  });

/** Where the receiver listens and how large a post may be. */
export interface TelemetryOptions {
  /** A free port when unset; the interactive homes' settings name a fixed one. */
  readonly port?: number;
  readonly limit?: number;
}

/**
 * Starts the receiver on 127.0.0.1, which keeps the token rows of its runs' and interactive homes' posts in the ledger
 * of `state`; refused when another program holds the port. It answers 404 to every other path or method, 401 without
 * a known token, 415 to anything but JSON, 413 to a body above `limit` bytes and 400 to one that is no JSON.
 */
export const startTelemetry = async (
  state: string,
  { port = 0, limit = 1024 * 1024 }: TelemetryOptions = {},
): Promise<Result<TelemetryReceiver>> => {
  const runs = new Map<string, TelemetryRun>();
  const keep = async (req: IncomingMessage, res: ServerResponse, run: TelemetryRun): Promise<void> => {
    const text = await bodyOf(req, limit);
    if (text === null) return answer(res, 413);
    const body = json(text);
    if (body === undefined) return answer(res, 400);
    const rows = tokenRowsOf(body, run);
    if (rows.length === 0) return answer(res, 200);
    const kept = await retryBusy(() =>
      withStore(state, (store) => {
        store.recordTokenRows(rows);
        return { ok: true, value: null };
      }),
    );
    // The exporter sends the batch again on a 503.
    return answer(res, kept.ok ? 200 : 503);
  };
  const server = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/logs") return answer(res.setHeader("connection", "close"), 404);
    const run = runOf(req, runs, state);
    if (run === null) return answer(res.setHeader("connection", "close"), 401);
    if (!(req.headers["content-type"] ?? "").startsWith("application/json")) return answer(res, 415);
    keep(req, res, run).catch(() => answer(res, 500));
  });
  const bound = await listen(server, port);
  if (bound === null) return { ok: false, finding: { code: "telemetry.port-taken", params: { port } } };
  const receiver: TelemetryReceiver = {
    endpoint: `http://127.0.0.1:${bound}/v1/logs`,
    register: (run) => {
      const token = randomBytes(24).toString("hex");
      runs.set(sha256(token), run);
      return token;
    },
    release: (token) => {
      runs.delete(sha256(token));
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        // A keep-alive connection would hold the close until it times out.
        server.closeAllConnections();
      }),
  };
  return { ok: true, value: receiver };
};

/** The interactive homes' receiver port: the registry's, else TELEMETRY_PORT, also when the registry cannot be read. */
export const telemetryPort = (config: string): number => {
  const loaded = loadRegistry(config);
  return (loaded.ok ? loaded.value?.telemetryPort : undefined) ?? TELEMETRY_PORT;
};

/** The env block of an agent's settings that sends its sessions' telemetry to `endpoint` with `token`. */
export type TelemetryEnv = (telemetry: { readonly endpoint: string; readonly token: string }) => Record<string, string>;

const Settings = z.looseObject({ env: z.record(z.string(), z.string()).optional() });

// The write of one interactive home's settings.json with the telemetry block in its env, private as it holds the
// token. Refused when the home sends telemetry already: an OTEL_ variable or one of the block's.
// shortcut: the block sets no NO_PROXY, as it would replace the user's own; a session behind a proxy may send its
// loopback post there (unverified), until the live check settles it.
const settingsWrite = (account: string, home: string, block: Record<string, string>): Result<Operation> => {
  const path = join(home, "settings.json");
  const file = readOptionalJson(path);
  if (!file.ok) return file;
  const settings = Settings.safeParse(file.value?.json ?? {});
  if (!settings.success) {
    const issues = settings.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code }));
    return { ok: false, finding: { code: "document.invalid", params: { issues } } };
  }
  const env = settings.data.env ?? {};
  if (Object.keys(env).some((key) => Object.hasOwn(block, key) || /^OTEL_/i.test(key))) {
    return { ok: false, finding: { code: "accounts.telemetry-set", params: { account, path } } };
  }
  const content = `${JSON.stringify({ ...settings.data, env: { ...env, ...block } }, null, 2)}\n`;
  const before = file.value === null ? null : sha256(file.value.text);
  return { ok: true, value: { kind: "write", path, before, content, mode: 0o600 } };
};

/** An account's name and its interactive homes. */
interface Interactive {
  readonly name: string;
  readonly aliases: readonly string[];
}

// The Claude accounts with interactive homes, and the endpoint their settings name.
const interactiveAccounts = (config: string): Result<{ accounts: Interactive[]; endpoint: string }> => {
  const loaded = loadRegistry(config);
  if (!loaded.ok) return loaded;
  const registry = loaded.value;
  const accounts = (registry?.accounts ?? []).flatMap(({ name, agent, aliases = [] }) =>
    agent === "claude" && aliases.length > 0 ? [{ name, aliases }] : [],
  );
  if (registry === null || accounts.length === 0) {
    return { ok: false, finding: { code: "accounts.no-alias", params: {} } };
  }
  return {
    ok: true,
    value: { accounts, endpoint: `http://127.0.0.1:${registry.telemetryPort ?? TELEMETRY_PORT}/v1/logs` },
  };
};

// The settings writes of one account's interactive homes with a fresh token of its own, and that token's hash.
const homeWrites = (
  account: Interactive,
  endpoint: string,
  settingsEnv: TelemetryEnv,
): Result<{ hash: string; writes: Operation[] }> => {
  const token = randomBytes(24).toString("hex");
  const block = settingsEnv({ endpoint, token });
  const writes: Operation[] = [];
  for (const home of account.aliases) {
    const write = settingsWrite(account.name, home, block);
    if (!write.ok) return write;
    writes.push(write.value);
  }
  return { ok: true, value: { hash: sha256(token), writes } };
};

/**
 * Plans `accounts telemetry`: the interactive homes (aliases) of each Claude account send their sessions' telemetry to
 * the receiver `cedarloom ui` runs, with a fresh token of the account's own. Each home's settings.json gets the block
 * and becomes private; the tokens file keeps the token's hash only. Workers never run in an alias, so no worker can
 * post with an interactive token.
 */
export const planTelemetry = (
  config: string,
  state: string,
  settingsEnv: TelemetryEnv,
): Result<{ plan: Plan; homes: string[] }> => {
  const found = interactiveAccounts(config);
  if (!found.ok) return found;
  const read = readTokens(state);
  if (!read.ok) return read;
  const { accounts, endpoint } = found.value;
  const hashes = { ...read.value.tokens.accounts };
  const operations: Operation[] = [];
  for (const account of accounts) {
    const planned = homeWrites(account, endpoint, settingsEnv);
    if (!planned.ok) return planned;
    hashes[account.name] = planned.value.hash;
    operations.push(...planned.value.writes);
  }
  const content = formatTelemetryTokens({ ...read.value.tokens, accounts: hashes });
  const before = read.value.text === null ? null : sha256(read.value.text);
  operations.push({ kind: "write", path: tokensPath(state), before, content, mode: 0o600 });
  const homes = accounts.flatMap((one) => one.aliases);
  return { ok: true, value: { plan: { schemaVersion: 1, operations }, homes } };
};
