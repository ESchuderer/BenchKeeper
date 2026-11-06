import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AgentVersion, TokenRow } from "@cedarloom/contracts";
import { sha256 } from "@cedarloom/ledger";
import { z } from "zod";
import { retryBusy, withStore } from "./use-cases.ts";

/** The run and account a receiver token stands for. */
export type TelemetryRun = Pick<TokenRow, "runId" | "account">;

/**
 * The launcher's loopback receiver of its workers' OpenTelemetry logs (OTLP over http/json). Each run posts with a token
 * of its own, which names its run and account, so a worker cannot post for another run.
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
const each = <T>(list: readonly unknown[], schema: z.ZodType<T>): T[] =>
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
  const value = Number(values.get(key));
  return values.has(key) && Number.isSafeInteger(value) ? value : null;
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
  each([body], Logs)
    .flatMap((logs) => each(logs.resourceLogs, Resource))
    .flatMap((resource) => each(resource.scopeLogs, Scope))
    .flatMap((scope) => each(scope.logRecords, LogRecord))
    .flatMap((record) => rowOf(valuesOf(each(record.attributes, Attribute)), run) ?? []);

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

// The run a request is from, by its bearer token; null for none or an unknown one. The runs are keyed by their token's
// hash, so a lookup never compares secret bytes.
const runOf = (req: IncomingMessage, runs: ReadonlyMap<string, TelemetryRun>): TelemetryRun | null => {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? (runs.get(sha256(header.slice("Bearer ".length))) ?? null) : null;
};

/**
 * Starts the receiver on 127.0.0.1 and a free port, which keeps the token rows of its runs' posts in the ledger of
 * `state`. It answers 404 to every other path or method, 401 without a run's token, 415 to anything but JSON, 413 to a
 * body above `limit` bytes and 400 to one that is no JSON.
 */
export const startTelemetry = async (state: string, limit = 1024 * 1024): Promise<TelemetryReceiver> => {
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
    const run = runOf(req, runs);
    if (run === null) return answer(res.setHeader("connection", "close"), 401);
    if (!(req.headers["content-type"] ?? "").startsWith("application/json")) return answer(res, 415);
    keep(req, res, run).catch(() => answer(res, 500));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = z.object({ port: z.number() }).parse(server.address());
  return {
    endpoint: `http://127.0.0.1:${port}/v1/logs`,
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
};
