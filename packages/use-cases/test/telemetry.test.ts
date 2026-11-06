import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openRunStore } from "@cedarloom/ledger";
import { startTelemetry, tokenRowsOf } from "@cedarloom/use-cases";
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
  const receiver = await startTelemetry(state, 16 * 1024);
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
  const receiver = await startTelemetry(state);
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
