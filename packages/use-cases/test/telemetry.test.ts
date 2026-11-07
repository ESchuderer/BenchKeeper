import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { claudeTelemetry } from "@cedarloom/adapter-claude";
import { formatRegistry, formatTelemetryTokens } from "@cedarloom/contracts";
import { openRunStore, sha256 } from "@cedarloom/ledger";
import {
  applyPlan,
  planTelemetry,
  startTelemetry,
  type TelemetryOptions,
  telemetryPort,
  telemetryProblems,
  tokenRowsOf,
} from "@cedarloom/use-cases";
import { expect, test } from "vitest";
import { z } from "zod";

// What Claude Code 2.1.316 exported in a live capture (2026-11-06), identity values replaced: a user_prompt event and an
// api_request event, as one OTLP http/json body.
const text = readFileSync(join(import.meta.dirname, "fixtures", "otlp-logs.jsonl"), "utf8");
const Attribute = z.object({ key: z.string(), value: z.record(z.string(), z.unknown()) });
const Body = z.object({
  resourceLogs: z.array(
    z.object({ scopeLogs: z.array(z.object({ logRecords: z.array(z.object({ attributes: z.array(Attribute) })) })) }),
  ),
});
const body = () => Body.parse(JSON.parse(text));

const run = { runId: "0b9f4c1e-8d2a-4c6b-9f3e-1a2b3c4d5e6f", account: "work" };
const ROW = {
  ...run,
  sessionId: "redacted",
  model: "claude-haiku-5-5",
  querySource: "sdk",
  effort: "low",
  inputTokens: 2,
  outputTokens: 4,
  cacheReadTokens: 0,
  cacheCreationTokens: 21226,
  cacheCreation5mTokens: 0,
  cacheCreation1hTokens: 21226,
  costUsdMicros: 4247,
  durationMs: 1126,
  requestId: "redacted",
  agentVersion: "2.1.316",
  at: "2026-11-06T21:24:15.848Z",
};

test("an api_request event becomes a token row of the run; other events and identity stay out", () => {
  expect(tokenRowsOf(body(), run)).toEqual([ROW]);
  const variant = body();
  const records = variant.resourceLogs[0]?.scopeLogs[0]?.logRecords ?? [];
  const api = records[1];
  if (api === undefined) throw new Error("no api_request in the fixture");
  // OTLP JSON may send an int64 as a string.
  const asString = structuredClone(api);
  asString.attributes = asString.attributes.map((a) =>
    a.key === "input_tokens" ? { ...a, value: { intValue: "7" } } : a,
  );
  // An odd entry costs only itself: a sibling record with a value of another shape (JSON.stringify makes NaN null), an
  // attribute of another shape in the api_request itself, a resource without scopes.
  const odd = { attributes: [{ key: "duration_ms", value: { doubleValue: null } }] };
  asString.attributes.push({ key: "speed", value: { doubleValue: null } });
  records.push(odd, asString);
  const resources: unknown[] = variant.resourceLogs;
  resources.push({ resource: {} });
  expect(tokenRowsOf(variant, run).map((row) => row.inputTokens)).toEqual([2, 7]);
  expect(tokenRowsOf({ resourceLogs: "none" }, run)).toEqual([]);
  expect(tokenRowsOf({ resourceLogs: [{ scopeLogs: [{}, { logRecords: [{}] }] }] }, run)).toEqual([]);
});

// The fixture's api_request record with its attributes changed: `set` replaces or adds values, `drop` removes keys.
const changed = (set: Record<string, Record<string, unknown>>, drop: readonly string[] = []) => {
  const variant = body();
  const record = variant.resourceLogs[0]?.scopeLogs[0]?.logRecords[1];
  if (record === undefined) throw new Error("no api_request in the fixture");
  const kept = record.attributes.filter((a) => !drop.includes(a.key) && !(a.key in set));
  record.attributes = [...kept, ...Object.entries(set).map(([key, value]) => ({ key, value }))];
  return tokenRowsOf(variant, run);
};

test("an api_request without the optional fields keeps them empty, and one without a time or tokens is no row", () => {
  // Cache splits from before 2.1.300 count as 0; an unknown version, a cost as a double, a bool value read as nothing.
  const sparse = changed(
    { "app.version": { stringValue: "unknown" }, cost_usd_micros: { doubleValue: 1.5 }, effort: { boolValue: true } },
    ["cache_creation_5m_tokens", "cache_creation_1h_tokens"],
  );
  expect(sparse).toEqual([
    {
      ...ROW,
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 0,
      agentVersion: null,
      costUsdMicros: null,
      effort: null,
    },
  ]);
  expect(changed({}, ["event.timestamp"])).toEqual([]);
  for (const intValue of ["many", "", " "]) expect(changed({ input_tokens: { intValue } })).toEqual([]);
});

const receiverAt = async (state: string, options?: TelemetryOptions) => {
  const started = await startTelemetry(state, options);
  if (!started.ok) throw new Error(started.finding.code);
  return started.value;
};

const stored = (state: string) => {
  const store = openRunStore(state);
  if (!store.ok) throw new Error(store.finding.code);
  try {
    return store.value.tokenRows();
  } finally {
    store.value.close();
  }
};

test("the receiver takes a run's posts with its token only, on /v1/logs, as JSON and within its size limit", async () => {
  const state = mkdtempSync(join(tmpdir(), "cedarloom-telemetry-"));
  const receiver = await receiverAt(state, { limit: 16 * 1024 });
  try {
    const token = receiver.register(run);
    const post = async (change: { url?: string; token?: string; type?: string; body?: string } = {}) => {
      // An empty type or token leaves its header out; bytes, unlike a string, get no type of fetch's own.
      const headers: Record<string, string> = {};
      const [type, bearer] = [change.type ?? "application/json", change.token ?? token];
      if (type !== "") headers["content-type"] = type;
      if (bearer !== "") headers["authorization"] = `Bearer ${bearer}`;
      const bytes = new TextEncoder().encode(change.body ?? text);
      const sent = await fetch(change.url ?? receiver.endpoint, { method: "POST", headers, body: bytes });
      return sent.status;
    };
    expect(receiver.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1\/logs$/);
    expect(await post({ token: "" })).toBe(401);
    expect(await post({ token: "wrong" })).toBe(401);
    expect(await post({ url: receiver.endpoint.replace("/v1/logs", "/v1/metrics") })).toBe(404);
    expect(await post({ type: "application/x-protobuf" })).toBe(415);
    expect(await post({ type: "" })).toBe(415);
    expect(await post({ body: "{" })).toBe(400);
    // Read to its end before the answer, so the exporter sees the 413 rather than a reset connection.
    expect(await post({ body: "x".repeat(64 * 1024) })).toBe(413);
    expect(await post({ body: JSON.stringify({ resourceLogs: [] }) })).toBe(200);
    expect(stored(state)).toEqual([]);
    expect(await post()).toBe(200);
    expect(stored(state)).toEqual([ROW]);
    // OTLP delivers at least once: a batch sent again after it was kept counts once.
    expect(await post()).toBe(200);
    expect(stored(state)).toEqual([ROW]);
    receiver.release(token);
    expect(await post()).toBe(401);
  } finally {
    await receiver.close();
  }
});

// The status of the fixture's post to a fresh receiver on `state`.
const postOnce = async (state: string): Promise<number> => {
  const receiver = await receiverAt(state);
  try {
    const headers = { "content-type": "application/json", authorization: `Bearer ${receiver.register(run)}` };
    return (await fetch(receiver.endpoint, { method: "POST", headers, body: new TextEncoder().encode(text) })).status;
  } finally {
    await receiver.close();
  }
};

test("a post the store refuses is answered 503 so the exporter sends it again, and one that fails is a 500", async () => {
  const newer = mkdtempSync(join(tmpdir(), "cedarloom-telemetry-"));
  const db = new DatabaseSync(join(newer, "runs.sqlite"));
  db.exec("PRAGMA user_version = 99");
  db.close();
  expect(await postOnce(newer)).toBe(503);
  // A file where the state folder belongs.
  const root = mkdtempSync(join(tmpdir(), "cedarloom-telemetry-"));
  writeFileSync(join(root, "state"), "");
  expect(await postOnce(join(root, "state"))).toBe(500);
});

// A free port: the one a receiver got and gave back.
const freePort = async (): Promise<number> => {
  const probe = await receiverAt(mkdtempSync(join(tmpdir(), "cedarloom-telemetry-")));
  await probe.close();
  return Number(new URL(probe.endpoint).port);
};

// A registry on the receiver port `port`, the default one when unset: the Claude account work with the interactive home `alias`, a Codex account
// with one, which is left out, and a Claude account without one.
const interactive = (port?: number) => {
  const root = mkdtempSync(join(tmpdir(), "cedarloom-interactive-"));
  const [config, state, alias] = ["config", "state", "alias"].map((name) => join(root, name));
  for (const folder of [config, state, alias]) mkdirSync(folder ?? root);
  const added = "2026-11-06T12:00:00.000Z";
  const accounts = [
    { name: "work", agent: "claude" as const, home: join(root, "work"), aliases: [alias ?? ""], pool: null, added },
    { name: "cx", agent: "codex" as const, home: join(root, "cx"), aliases: [join(root, "codex")], pool: null, added },
    { name: "solo", agent: "claude" as const, home: join(root, "solo"), pool: null, added },
  ];
  const registry = { schemaVersion: 1 as const, minimum: { fiveHour: 8, sevenDay: 3 }, accounts, pools: {} };
  const document = port === undefined ? registry : { ...registry, telemetryPort: port };
  writeFileSync(join(config ?? root, "accounts.json"), formatRegistry(document));
  return { root, config: config ?? root, state: state ?? root, settings: join(alias ?? root, "settings.json") };
};

const Settings = z.object({ model: z.string(), env: z.record(z.string(), z.string()) });

test("an interactive home posts as its account once accounts telemetry is applied, with its settings kept", async () => {
  const port = await freePort();
  const { config, state, settings } = interactive(port);
  writeFileSync(settings, JSON.stringify({ model: "opus", env: { KEEP: "1" } }));
  const planned = planTelemetry(config, state, claudeTelemetry, {});
  if (!planned.ok) throw new Error(planned.finding.code);
  // The settings become private, as they hold the token; the tokens file keeps its hash only.
  expect(planned.value.plan.operations).toMatchObject([
    { path: settings, mode: 0o600 },
    { path: join(state, "telemetry.json"), before: null, mode: 0o600 },
  ]);
  expect(applyPlan(state, planned.value.plan, { yes: true })).toMatchObject({ ok: true, value: { status: "applied" } });
  const written = Settings.parse(JSON.parse(readFileSync(settings, "utf8")));
  expect(written).toMatchObject({ model: "opus", env: { KEEP: "1", OTEL_LOGS_EXPORTER: "otlp" } });
  // The token as the plan carries it, which the apply wrote into the settings.
  const op = planned.value.plan.operations[0];
  const block = Settings.parse(JSON.parse(op?.kind === "write" ? op.content : "{}")).env;
  expect(written.env).toEqual(block);
  const authorization = (block["OTEL_EXPORTER_OTLP_LOGS_HEADERS"] ?? "").replace(/^Authorization=/, "");
  expect(readFileSync(join(state, "telemetry.json"), "utf8")).not.toContain(authorization.slice("Bearer ".length));
  // The receiver of cedarloom ui, on the registry's port, keeps the home's rows as the account's, with no run.
  const receiver = await receiverAt(state, { port });
  try {
    expect(written.env["OTEL_EXPORTER_OTLP_LOGS_ENDPOINT"]).toBe(receiver.endpoint);
    const headers = { "content-type": "application/json", authorization };
    const bytes = new TextEncoder().encode(text);
    expect((await fetch(receiver.endpoint, { method: "POST", headers, body: bytes })).status).toBe(200);
    expect(stored(state)).toEqual([{ ...ROW, runId: null }]);
    // A second receiver on the port is refused, and the doctor sees the receiver as no problem.
    const taken = { ok: false, finding: { code: "telemetry.port-taken", params: { port } } };
    expect([await startTelemetry(state, { port }), await telemetryProblems(config, state)]).toEqual([taken, []]);
    // A run again replaces CedarLoom's own block, with a new token: the old one is refused.
    const again = planTelemetry(config, state, claudeTelemetry, {});
    if (!again.ok) throw new Error(again.finding.code);
    applyPlan(state, again.value.plan, { yes: true });
    expect((await fetch(receiver.endpoint, { method: "POST", headers, body: bytes })).status).toBe(401);
  } finally {
    await receiver.close();
  }
});

test("a shell or a home that sends telemetry of its own is refused, and CedarLoom's own block is replaced", () => {
  const { config, state, settings } = interactive();
  const planned = () => planTelemetry(config, state, claudeTelemetry, {});
  // A shell's own telemetry is refused, as the settings would override it; a variable without a value is none.
  const exported = planTelemetry(config, state, claudeTelemetry, { PATH: "/bin", BETA_TRACING_ENDPOINT: "https://x" });
  expect(exported).toEqual({
    ok: false,
    finding: { code: "accounts.telemetry-exported", params: { variable: "BETA_TRACING_ENDPOINT" } },
  });
  const set = { ok: false, finding: { code: "accounts.telemetry-set", params: { account: "work", path: settings } } };
  for (const own of [
    { env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector.example" } },
    { env: { CLAUDE_CODE_ENABLE_TELEMETRY: "1" } },
    { env: { BETA_TRACING_ENDPOINT: "https://collector.example" } },
    { otelHeadersHelper: "/usr/local/bin/otel-headers" },
  ]) {
    writeFileSync(settings, JSON.stringify(own));
    expect(planTelemetry(config, state, claudeTelemetry, { OTEL_EXPORTER_OTLP_ENDPOINT: undefined })).toEqual(set);
  }
  // CedarLoom's own block, by the account's token, is replaced; beside a variable of the user's it is not.
  const token = "ab".repeat(24);
  const tokens = { schemaVersion: 1, kind: "cedarloom.telemetry-tokens", accounts: { work: sha256(token) } } as const;
  writeFileSync(join(state, "telemetry.json"), formatTelemetryTokens(tokens));
  const block = claudeTelemetry.env({ endpoint: "http://127.0.0.1:4319/v1/logs", token });
  writeFileSync(settings, JSON.stringify({ env: block }));
  expect(planned()).toMatchObject({ ok: true });
  writeFileSync(settings, JSON.stringify({ env: { ...block, OTEL_TRACES_EXPORTER: "otlp" } }));
  expect(planned()).toEqual(set);
});

test("accounts telemetry is refused without an interactive home, and for settings it cannot rewrite", async () => {
  const { root, config, state, settings } = interactive();
  const planned = () => planTelemetry(config, state, claudeTelemetry, {});
  // Settings that are no JSON, or whose env holds other than text, are not rewritten.
  for (const content of ["{", JSON.stringify({ env: { KEEP: 1 } })]) {
    writeFileSync(settings, content);
    expect(planned()).toMatchObject({ ok: false, finding: { code: "document.invalid" } });
  }
  writeFileSync(settings, "{}");
  // A tokens file of another kind stops the plan and every interactive token; the other accounts' tokens are kept.
  writeFileSync(join(state, "telemetry.json"), "{}");
  expect(planned()).toMatchObject({ ok: false, finding: { code: "document.invalid" } });
  const receiver = await receiverAt(state);
  try {
    const headers = { "content-type": "application/json", authorization: "Bearer unknown" };
    expect((await fetch(receiver.endpoint, { method: "POST", headers, body: "{}" })).status).toBe(401);
  } finally {
    await receiver.close();
  }
  const old = { schemaVersion: 1, kind: "cedarloom.telemetry-tokens", accounts: { old: "a".repeat(64) } } as const;
  writeFileSync(join(state, "telemetry.json"), formatTelemetryTokens(old));
  // A home without settings gets new ones, which name the default port when the registry names none.
  rmSync(settings);
  const kept = planned();
  expect(kept.ok && kept.value.plan.operations).toMatchObject([
    { path: settings, before: null, content: expect.stringContaining("http://127.0.0.1:24318/v1/logs") },
    { content: expect.stringContaining('"old"') },
  ]);
  // A tokens file it cannot read.
  const elsewhere = join(root, "elsewhere");
  mkdirSync(join(elsewhere, "telemetry.json"), { recursive: true });
  expect(planTelemetry(config, elsewhere, claudeTelemetry, {})).toMatchObject({
    ok: false,
    finding: { code: "document.unreadable" },
  });
  const none = { ok: false, finding: { code: "accounts.no-alias", params: {} } };
  expect(planTelemetry(join(root, "nowhere"), state, claudeTelemetry, {})).toEqual(none);
  // The receiver's port: the registry's, else the default one, also when the registry cannot be read.
  const ports = [telemetryPort(config), telemetryPort(interactive(4319).config), telemetryPort(join(root, "nowhere"))];
  expect(ports).toEqual([24318, 4319, 24318]);
  writeFileSync(join(config, "accounts.json"), "{");
  expect(planned()).toMatchObject({ ok: false, finding: { code: "document.invalid" } });
  expect(telemetryPort(config)).toBe(24318);
});

test("the doctor warns when a program other than the receiver answers on the interactive homes' port", async () => {
  const port = await freePort();
  const { config, state } = interactive(port);
  // No home sends there yet, so there is nothing to check.
  expect(await telemetryProblems(config, state)).toEqual([]);
  const tokens = { schemaVersion: 1, kind: "cedarloom.telemetry-tokens", accounts: { work: "a".repeat(64) } } as const;
  writeFileSync(join(state, "telemetry.json"), formatTelemetryTokens(tokens));
  // Nobody on the port: the posts fail, and nothing gets them.
  expect(await telemetryProblems(config, state)).toEqual([]);
  const other = createServer((_req, res) => res.end("ok"));
  await new Promise<void>((resolve) => other.listen(port, "127.0.0.1", resolve));
  try {
    expect(await telemetryProblems(config, state)).toEqual([{ code: "doctor.telemetry-port-held", params: { port } }]);
  } finally {
    await new Promise<void>((resolve) => other.close(() => resolve()));
  }
});
