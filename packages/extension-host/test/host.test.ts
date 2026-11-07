import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { ExtensionManifest, type Result } from "@cedarloom/contracts";
import {
  type ExtensionLaunch,
  framesUpTo,
  type Hop,
  type HopAnswer,
  type RunningExtension,
  sandboxRuntime,
  startExtension,
  type Transport,
} from "@cedarloom/extension-host";
import { HOST_FAILED, HOST_MISSING, HOST_REFUSED } from "@cedarloom/extension-sdk";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import { CONFORMANT, conformance, SANDBOX_ONLY } from "./conformance.ts";

const ACTIONS = [
  "echo",
  "chatty",
  "call-host",
  "oversize",
  "crash",
  "bad-outputs",
  "refuse",
  "stubborn",
  "deep-error",
  "flood",
  "request-flood",
  "abuse",
  "wait",
  "fetch",
  "fetch-cancel",
  "fetch-cancelled",
  "fetch-then-crash",
  "exec",
];
const manifestOf = (actions: string[], api = "1.0", capabilities?: unknown): ExtensionManifest =>
  ExtensionManifest.parse({
    capabilities,
    schemaVersion: 1,
    kind: "cedarloom.extension",
    id: "acme.fixture",
    version: "1.0.0",
    name: "Fixture",
    api,
    runtime: { kind: "node", entry: "main.mjs" },
    contributes: { actions: Object.fromEntries(actions.map((action) => [action, { title: action }])) },
  });
const folder = join(import.meta.dirname, "fixtures", "extension");
const scratch = mkdtempSync(join(process.env["RUNNER_TEMP"] ?? tmpdir(), "cedarloom-host-"));

const started: RunningExtension[] = [];
afterEach(async () => {
  await Promise.all(started.splice(0).map((extension) => extension.stop()));
});
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const start = async (more: Partial<ExtensionLaunch> = {}): Promise<Result<RunningExtension>> => {
  const result = await startExtension({
    manifest: manifestOf(ACTIONS),
    folder,
    trust: "bundled",
    locale: "en",
    ...more,
  });
  if (result.ok) started.push(result.value);
  return result;
};
const extension = async (more: Partial<ExtensionLaunch> = {}): Promise<RunningExtension> => {
  const result = await start(more);
  if (!result.ok) throw new Error(result.finding.code);
  return result.value;
};
const run = (target: RunningExtension, action: string, signal?: AbortSignal, config: unknown = { query: "x" }) =>
  target.run({ action, config, inputs: { project: "CL" }, run: `r-${action}` }, signal);
const codeOf = (result: Result<unknown>): unknown => (result.ok ? result.value : result.finding);
const failure = (step: string, error: unknown) => ({
  code: "extension.failed",
  params: { extension: "acme.fixture", step, error },
});
const refusal = (reason: string) => ({ code: "extension.refused", params: { extension: "acme.fixture", reason } });

test("a bundled extension runs an action, and keeps bounded, safely shown log lines of its runs until read", async () => {
  const fixture = await extension({ limits: { logLines: 3, logChars: 16 } });
  await run(fixture, "echo");
  const echoed = await run(fixture, "echo");
  await run(fixture, "chatty");
  expect([codeOf(echoed), fixture.log("r-chatty"), fixture.log("r-chatty"), fixture.log("another run")]).toEqual([
    { config: { query: "x" }, inputs: { project: "CL" }, run: "r-echo" },
    {
      lines: [
        { run: "r-chatty", level: "info", message: "line\\u001b 0 xxx" },
        { run: "r-chatty", level: "warning", message: "line\\u001b 1 xxx" },
        { run: "r-chatty", level: "error", message: "line\\u001b 2 xxx" },
      ],
      dropped: 1,
    },
    { lines: [], dropped: 0 },
    { lines: [], dropped: 0 },
  ]);
});

test("the conformance kit: no write, read outside, process, worker, network, DNS, addon, descriptor or sqlite", async () => {
  const kit = codeOf(await conformance(await extension()));
  // Signals stay a check only an OS sandbox can pass.
  expect([kit, SANDBOX_ONLY.signal.includes(String(Reflect.get(Object(kit), "signal")))]).toEqual([CONFORMANT, false]);
});

test("the host answers no call of the extension but its own: any other is a method that does not exist", async () => {
  expect(codeOf(await run(await extension(), "call-host"))).toEqual({ code: -32601 });
});

test("an extension is refused for another protocol, other actions, an old Node, or a trust this machine cannot confine", async () => {
  const wraps = {
    wrap: (launch: Parameters<NonNullable<ExtensionLaunch["sandbox"]>["wrap"]>[0]) => Promise.resolve(launch),
  };
  const results = await Promise.all([
    start({ manifest: manifestOf(ACTIONS, "2.0") }),
    start({ manifest: manifestOf(ACTIONS, "1.1") }),
    start({ locale: "x-old" }),
    start({ locale: "x-garbled" }),
    start({ locale: "x-fewer" }),
    start({ locale: "x-noactions" }),
    start({ locale: "x-deep" }),
    start({ manifest: manifestOf([...ACTIONS, "more"]) }),
    start({ node: "24.11.0" }),
    start({ trust: "community", platform: "linux" }),
    start({ trust: "community", platform: "win32", sandbox: wraps }),
    start({ trust: "community", platform: "darwin", sandbox: wraps }),
  ]);
  expect(results.map((result) => (result.ok ? "started" : result.finding))).toEqual([
    ...["protocol", "protocol", "protocol", "protocol", "actions", "actions", "actions", "actions"].map(refusal),
    ...["runtime", "sandbox-unavailable", "windows"].map(refusal),
    "started",
  ]);
});

// A copy of the fixture's folder under `name` in the scratch folder, with a link to `target` at `at` when given.
const copyOf = (name: string, target?: string, at = "outside"): string => {
  const copy = join(scratch, name);
  mkdirSync(join(copy, dirname(at)), { recursive: true });
  copyFileSync(join(folder, "main.mjs"), join(copy, "main.mjs"));
  if (target !== undefined) symlinkSync(target, join(copy, at));
  return copy;
};

test.skipIf(process.platform === "win32")(
  "a folder that would widen the grant is refused: a * or ? in its path, a link inside, found without following it",
  async () => {
    // A folder this user may not read: a link to it is refused, not followed into an error.
    const closed = join(scratch, "closed");
    mkdirSync(closed, { mode: 0o000 });
    const results = await Promise.all([
      start({ folder: copyOf("with*star") }),
      start({ folder: copyOf("with?mark") }),
      start({ folder: copyOf("with-link", scratch) }),
      // One folder down: the check reads every folder, not only the top one.
      start({ folder: copyOf("with-closed-link", closed, "lib/outside") }),
      start({ folder: copyOf("plain") }),
    ]);
    // Readable again, so the scratch folder can be removed.
    chmodSync(closed, 0o700);
    expect(results.map((result) => (result.ok ? "started" : result.finding))).toEqual([
      refusal("folder"),
      refusal("folder"),
      refusal("folder"),
      refusal("folder"),
      "started",
    ]);
  },
);

test("a run fails on an oversize message, a crash, an answer without outputs, its refusal, or the host's cancel", async () => {
  const fixtures = await Promise.all([extension(), extension(), extension(), extension(), extension()]);
  const cancel = new AbortController();
  const waiting = run(fixtures[3], "wait", cancel.signal);
  setTimeout(() => cancel.abort(), 50);
  const results = await Promise.all([
    run(fixtures[0], "oversize"),
    run(fixtures[1], "crash"),
    run(fixtures[2], "bad-outputs"),
    waiting,
    run(fixtures[4], "refuse"),
  ]);
  expect(results.map(codeOf)).toEqual([
    failure("run", "a message over 1048576 bytes"),
    failure("run", expect.any(String)),
    failure("run", "no outputs"),
    failure("run", "cancelled by the host"),
    // The extension's own text, shown safely.
    failure("run", "the tracker refused\\u001b[2K\\u202e"),
  ]);
});

test("a cancelled run that the extension ignores ends at the stop limit, and an aborted signal runs nothing", async () => {
  const stubborn = await extension({ limits: { stopMs: 100 } });
  const began = Date.now();
  const ignored = await run(stubborn, "stubborn", AbortSignal.timeout(50));
  const fixture = await extension();
  const aborted = AbortSignal.abort();
  const never = await run(fixture, "chatty", aborted);
  expect([codeOf(ignored), Date.now() - began < 2000, codeOf(never), fixture.log("r-chatty")]).toEqual([
    failure("run", "cancelled by the host"),
    true,
    failure("run", "cancelled by the host"),
    { lines: [], dropped: 0 },
  ]);
});

test("S1: a run whose answer the reader cannot build ends with the extension, after the deadline and the kill", async () => {
  const deep = await extension({ limits: { stopMs: 100 } });
  const began = Date.now();
  const unbuilt = await run(deep, "deep-error", AbortSignal.timeout(100));
  expect([codeOf(unbuilt), Date.now() - began < 3000]).toEqual([failure("run", "cancelled by the host"), true]);
});

test("S9: a run after the extension ended answers a Result", async () => {
  const crashed = await extension();
  await run(crashed, "crash");
  expect(codeOf(await run(crashed, "echo"))).toEqual(failure("run", expect.any(String)));
});

test("S10: a flood of requests whose answers the extension never reads ends it at the unread bound", async () => {
  const flooded = await extension({ limits: { unreadMessages: 200, stopMs: 100 } });
  expect(codeOf(await run(flooded, "request-flood"))).toEqual(failure("run", "over 200 messages unread"));
});

test("S10: a flood of small frames past the unread bound ends the extension", async () => {
  const flooded = await extension({ limits: { unreadMessages: 200 } });
  expect(codeOf(await run(flooded, "flood"))).toEqual(failure("run", "over 200 messages unread"));
});

test("an extension that does not start or answer fails with the reason and ends, and one that ignores exit is killed", async () => {
  const gone = ExtensionManifest.parse({ ...manifestOf(ACTIONS), runtime: { kind: "node", entry: "gone.mjs" } });
  const nowhere = {
    wrap: () => Promise.resolve({ command: join(folder, "no-such-program"), args: [], cwd: folder, env: {} }),
  };
  const failures = await Promise.all([
    start({ manifest: gone }),
    start({ locale: "x-silent", limits: { startMs: 200 } }),
    start({ trust: "community", platform: "linux", sandbox: nowhere }),
    start({ folder: join(scratch, "missing") }),
  ]);
  const deaf = await extension({ locale: "x-deaf", limits: { stopMs: 100 } });
  const began = Date.now();
  await deaf.stop();
  expect([...failures.map(codeOf), Date.now() - began < 2000]).toEqual([
    failure("initialize", expect.stringMatching(/gone\.mjs/)),
    failure("initialize", "no answer to the handshake"),
    failure("initialize", expect.stringMatching(/ENOENT/)),
    failure("start", expect.stringMatching(/ENOENT/)),
    true,
  ]);
});

const through = async (limit: number, chunks: string[]): Promise<string> => {
  const guard = framesUpTo(limit);
  const out: Buffer[] = [];
  guard.on("data", (chunk: Buffer) => out.push(chunk));
  const ended = new Promise<string>((resolve) => {
    guard.on("error", (error) => resolve(`error: ${error.message}`));
    guard.on("end", () => resolve(Buffer.concat(out).toString()));
  });
  const source = new PassThrough();
  source.pipe(guard);
  for (const chunk of chunks) source.write(chunk);
  source.end();
  return ended;
};

test("the frame guard passes frames under its own header, split anywhere, and ends at a header it cannot trust", async () => {
  const frames = "Content-Length: 2\r\nContent-Type: application/json\r\n\r\n{}content-length:3\r\n\r\n[1]";
  const results = await Promise.all([
    through(10, frames.split("")),
    through(10, [`X-Long: ${"x".repeat(1100)}`]),
    through(10, [`X-Long: ${"x".repeat(1100)}\r\nContent-Length: 2\r\n\r\n{}`]),
    through(10, ["X-Other: 1\r\n\r\n{}"]),
    // vscode-jsonrpc reads the last length of two, which could pass a large frame this guard never checked.
    through(10, ["Content-Length: 2\r\nContent-Length: 500000000\r\n\r\n{}"]),
    through(10, ["Content-Length: 11\r\n\r\n"]),
  ]);
  expect(results).toEqual([
    "Content-Length: 2\r\n\r\n{}Content-Length: 3\r\n\r\n[1]",
    "error: a frame header over 1024 bytes",
    "error: a frame header over 1024 bytes",
    "error: a frame without exactly one Content-Length",
    "error: a frame without exactly one Content-Length",
    "error: a message over 10 bytes",
  ]);
});

const [API, OTHER] = ["https://api.acme.example", "https://other.acme.example"];
const BEARER = { type: "http", scheme: "bearer" };
const capabilities = {
  net: [API, OTHER],
  credentials: {
    token: { scheme: BEARER, hosts: [API] },
    login: { scheme: { type: "http", scheme: "basic" }, hosts: [API] },
    key: { scheme: { type: "apiKey", in: "header", name: "X-Api-Key" }, hosts: [API] },
    unset: { scheme: BEARER, hosts: [API] },
    locked: { scheme: BEARER, hosts: [API] },
    short: { scheme: { type: "http", scheme: "basic" }, hosts: [API] },
    stalled: { scheme: BEARER, hosts: [API] },
  },
};
const SECRETS: Record<string, { secret: string; user?: string }> = {
  token: { secret: "s3cret-token" },
  login: { user: "ada", secret: "pw" },
  // A secret inside its own basic form: "YWRhOlk=" is ada:Y.
  short: { user: "ada", secret: "Y" },
  key: { secret: "k3y/+=" },
};
// The user's store of credentials: one it cannot open throws, one never answers.
const store = (id: string) => {
  if (id === "locked") throw new Error("the keychain is locked");
  return id === "stalled" ? new Promise<undefined>(() => undefined) : SECRETS[id];
};
const answer = (status: number, body = "ok", headers: Record<string, string> = {}): HopAnswer => ({
  status,
  headers,
  body: Buffer.from(body),
});
const moved = (status: number, location: string): HopAnswer => answer(status, "", { location });
// The far side of each path: redirects, an echo of what was sent, one that never answers, and one that is down.
const SERVED: Record<string, (hop: Hop) => HopAnswer | Promise<HopAnswer>> = {
  "/redirect": () => moved(302, `${OTHER}/landed`),
  "/away": () => moved(301, "https://elsewhere.example/"),
  "/loop": () => moved(307, "/loop"),
  "/see-other": () => moved(303, "/landed"),
  "/echo": (hop) =>
    answer(200, `you sent ${JSON.stringify(hop.headers)}`, { "x-echo": hop.headers["authorization"] ?? "" }),
  "/slow": (hop) =>
    new Promise((_, reject) => hop.signal.addEventListener("abort", () => reject(new Error("aborted")))),
  "/down": () => Promise.reject(new Error("connect ECONNREFUSED")),
  "/echo-key": (hop) => answer(200, `key=${encodeURIComponent(hop.headers["x-api-key"] ?? "")}`),
  "/gzip": () => answer(200, "\u001f\u008b", { "content-encoding": "gzip" }),
  "/identity": () => answer(200, "ok", { "content-encoding": "Identity" }),
};
const sent: { url: string; method: string; headers: Record<string, string>; body?: string | undefined }[] = [];
const fake: Transport = (hop) => {
  sent.push({ url: hop.url.href, method: hop.method, headers: hop.headers, body: hop.body });
  return Promise.resolve((SERVED[hop.url.pathname] ?? (() => answer(200)))(hop));
};
// What the fake transport was sent for a path, by URL.
const at = (path: string) =>
  sent.filter((hop) => new URL(hop.url).pathname === path).toSorted((one, two) => one.url.localeCompare(two.url));
const ok = (url: string, body = "ok", headers = {}) => ({ result: { status: 200, url, headers, body } });
const no = (message: string) => ({ error: { code: 2, message } });
const down = (message: string) => ({ error: { code: 3, message } });
const basic = `Basic ${Buffer.from("ada:pw").toString("base64")}`;

const JSON_BODY = { "Content-Type": "application/json" };
const FETCHES: [string, unknown, unknown][] = [
  ["a granted origin", { url: `${API}/ok` }, ok(`${API}/ok`)],
  ["another origin", { url: "https://elsewhere.example/" }, no("https://elsewhere.example is not granted")],
  ["the origin over http", { url: "http://api.acme.example/" }, no("http://api.acme.example is not granted")],
  ["no URL", { url: "api.acme.example" }, no("not a URL")],
  ["a user in the URL", { url: "https://ada@api.acme.example/" }, no("a URL with a user or password")],
  ["an unknown credential", { url: API, credential: "nope" }, no("no credential nope")],
  ["a credential for another host", { url: OTHER, credential: "token" }, no(`credential token is not for ${OTHER}`)],
  [
    "a credential's header set by the extension",
    { url: API, credential: "key", headers: { "x-api-key": "mine" } },
    no("the credential key sets x-api-key"),
  ],
  ["a framing header", { url: API, headers: { Host: "evil.example" } }, no("invalid headers.Host")],
  ["a hop-by-hop header", { url: API, headers: { Upgrade: "h2c" } }, no("invalid headers.Upgrade")],
  ["a header value over lines", { url: API, headers: { "x-a": "1\r\nx-b: 2" } }, no("invalid headers.x-a")],
  ["a body on GET", { url: API, body: "x" }, no("invalid body")],
  ["another method", { url: API, method: "TRACE" }, no("invalid method")],
  [
    "a coded answer asked for",
    { url: API, headers: { "Accept-Encoding": "gzip" } },
    no("invalid headers.Accept-Encoding"),
  ],
  ["an unknown field", { url: API, timeout: 5 }, no("invalid request")],
  ["a redirect within the grant", { url: `${API}/redirect`, credential: "token" }, ok(`${OTHER}/landed`)],
  ["a redirect elsewhere", { url: `${API}/away` }, no("a redirect to an origin that is not granted")],
  ["a redirect loop", { url: `${API}/loop` }, down("more than 5 redirects")],
  [
    "a 303 after a POST, the extension's own Authorization kept on its origin",
    { url: `${API}/see-other`, method: "POST", body: "{}", headers: { ...JSON_BODY, Authorization: "Bearer mine" } },
    ok(`${API}/landed`),
  ],
  [
    "a 302 after a POST, its own Cookie dropped for another origin",
    { url: `${API}/redirect`, method: "POST", body: "{}", headers: { ...JSON_BODY, Cookie: "s=1" } },
    ok(`${OTHER}/landed`),
  ],
  [
    "its own Authorization and Cookie dropped for another origin",
    { url: `${API}/redirect`, headers: { Authorization: "Bearer mine", Cookie: "s=1" } },
    ok(`${OTHER}/landed`),
  ],
  [
    "a POST through 307s",
    { url: `${API}/loop`, method: "POST", body: "{}", headers: JSON_BODY },
    down("more than 5 redirects"),
  ],
  [
    "a credential echoed back",
    { url: `${API}/echo`, credential: "token" },
    ok(`${API}/echo`, 'you sent {"authorization":"Bearer [redacted]"}', { "x-echo": "Bearer [redacted]" }),
  ],
  ["basic", { url: `${API}/basic`, credential: "login" }, ok(`${API}/basic`)],
  ["an API key", { url: `${API}/key`, credential: "key", method: "DELETE" }, ok(`${API}/key`)],
  [
    "a credential echoed URL-encoded",
    { url: `${API}/echo-key`, credential: "key" },
    ok(`${API}/echo-key`, "key=[redacted]"),
  ],
  ["a coded answer", { url: `${API}/gzip` }, down("an answer coded as gzip, which the host does not decode")],
  [
    "an identity-coded answer",
    { url: `${API}/identity` },
    ok(`${API}/identity`, "ok", { "content-encoding": "Identity" }),
  ],
  ["a host that is down", { url: `${API}/down` }, down("connect ECONNREFUSED")],
  ["a credential without a value", { url: API, credential: "unset" }, down("credential unset has no value")],
  ["a store that cannot be read", { url: API, credential: "locked" }, down("the keychain is locked")],
  ["a store that never answers", { url: API, credential: "stalled" }, down("no answer within 100 ms")],
  [
    "a short secret inside its basic form",
    { url: `${API}/echo`, credential: "short" },
    ok(`${API}/echo`, 'you sent {"authorization":"Basic [redacted]"}', { "x-echo": "Basic [redacted]" }),
  ],
  ["no answer in time", { url: `${API}/slow` }, down("no answer within 100 ms")],
];

test("host/fetch reaches granted origins only, adds a credential for its hosts only, and follows redirects within the grant", async () => {
  const fetcher = await extension({
    manifest: manifestOf(ACTIONS, "1.0", capabilities),
    credentials: store,
    transport: fake,
    limits: { fetchMs: 100, fetches: 100 },
  });
  const requests = FETCHES.map(([, request]) => request);
  const answers = codeOf(await run(fetcher, "fetch", undefined, { requests }));
  expect(answers).toEqual({
    answers: FETCHES.map(([, , expected]) => expected),
    granted: { net: [API, OTHER], credentials: ["token", "login", "key", "unset", "locked", "short", "stalled"] },
  });
  // The credential goes to its host and not on to another, and so do the extension's own Authorization and Cookie; a
  // 303, or a 302 after a POST, turns the POST into a GET without its body and the headers that describe it, and a 307
  // keeps them.
  const landed = { method: "GET", headers: {}, body: undefined };
  const json = { "content-type": "application/json" };
  const loops = at("/loop").map((hop) => `${hop.method} ${String(hop.body)} ${hop.headers["content-type"] ?? "-"}`);
  expect([at("/redirect"), at("/landed"), loops.toSorted(), at("/basic"), at("/key")]).toEqual([
    [
      { url: `${API}/redirect`, method: "GET", headers: { authorization: "Bearer s3cret-token" }, body: undefined },
      { url: `${API}/redirect`, method: "POST", headers: { ...json, cookie: "s=1" }, body: "{}" },
      {
        url: `${API}/redirect`,
        method: "GET",
        headers: { authorization: "Bearer mine", cookie: "s=1" },
        body: undefined,
      },
    ],
    [
      { url: `${API}/landed`, method: "GET", headers: { authorization: "Bearer mine" }, body: undefined },
      { url: `${OTHER}/landed`, ...landed },
      { url: `${OTHER}/landed`, ...landed },
      { url: `${OTHER}/landed`, ...landed },
    ],
    [
      ...Array.from({ length: 6 }, () => "GET undefined -"),
      ...Array.from({ length: 6 }, () => "POST {} application/json"),
    ],
    [{ url: `${API}/basic`, method: "GET", headers: { authorization: basic }, body: undefined }],
    [{ url: `${API}/key`, method: "DELETE", headers: { "x-api-key": "k3y/+=" }, body: undefined }],
  ]);
});

test("an extension without capabilities is granted nothing, and more requests at once than the limit are refused", async () => {
  const fetcher = await extension({ transport: fake, limits: { fetches: 1, fetchMs: 100 } });
  const granted = await extension({
    manifest: manifestOf(ACTIONS, "1.0", capabilities),
    transport: fake,
    limits: { fetches: 1, fetchMs: 100 },
  });
  const requests = [{ url: `${API}/slow` }, { url: `${API}/ok` }];
  expect([
    codeOf(await run(fetcher, "fetch", undefined, { requests: [{ url: API }] })),
    codeOf(await run(granted, "fetch", undefined, { requests })),
  ]).toEqual([
    { answers: [no(`${API} is not granted`)], granted: { net: [], credentials: [] } },
    {
      answers: [down("no answer within 100 ms"), no("too many requests at once (limit 1)")],
      granted: expect.anything(),
    },
  ]);
});

test("S10: cancels of requests the host is still handling count as read, so they never reach the unread bound", async () => {
  const fetcher = await extension({
    manifest: manifestOf(ACTIONS, "1.0", capabilities),
    transport: fake,
    limits: { unreadMessages: 20 },
  });
  expect(codeOf(await run(fetcher, "fetch-cancel", undefined, { count: 60 }))).toEqual({});
});

test("a request whose cancel comes before the host has started on it is not sent, and answers at once", async () => {
  const fetcher = await extension({
    manifest: manifestOf(ACTIONS, "1.0", capabilities),
    transport: fake,
    limits: { fetchMs: 1000 },
  });
  expect(codeOf(await run(fetcher, "fetch-cancelled"))).toEqual({
    error: { code: HOST_FAILED, message: "not sent: the request was cancelled or the extension ended" },
  });
});

test("an extension that ends stops the requests the host sends for it", async () => {
  const ended: string[] = [];
  const hanging: Transport = (hop) =>
    new Promise((_, reject) =>
      hop.signal.addEventListener("abort", () => {
        ended.push(hop.url.pathname);
        reject(new Error("aborted"));
      }),
    );
  const fetcher = await extension({ manifest: manifestOf(ACTIONS, "1.0", capabilities), transport: hanging });
  const result = await run(fetcher, "fetch-then-crash");
  expect([codeOf(result), ended]).toEqual([failure("run", expect.any(String)), ["/hang"]]);
});

test.skipIf(process.platform === "win32")(
  "a community extension runs inside sandbox-runtime and passes the conformance kit, the host's signals included",
  async ({ skip }) => {
    const confined = await start({ trust: "community", sandbox: sandboxRuntime() });
    // A machine where no sandboxed process starts (the rootless dev container) is skipped; CI's runners are not.
    if (!confined.ok && process.env["CI"] !== "true") skip(JSON.stringify(confined.finding));
    if (!confined.ok) throw new Error(JSON.stringify(confined.finding));
    started.push(confined.value);
    const kit = Object(codeOf(await conformance(confined.value)));
    const signal = String(Reflect.get(kit, "signal"));
    expect({ ...kit, signal: SANDBOX_ONLY.signal.includes(signal) ? "refused" : signal }).toEqual({
      ...CONFORMANT,
      signal: "refused",
    });
  },
  30_000,
);

test("sandbox-runtime wraps nothing on Windows, whose sandbox needs an install of its own", async () => {
  const launch = { command: process.execPath, args: [], cwd: folder, env: {} };
  expect(await sandboxRuntime("win32").wrap(launch, { read: [folder], write: [], network: "none" })).toBeUndefined();
});

// The fixture with `programs` in its manifest: `node`, found on PATH (on Windows node.exe), and more as a test names.
const withPrograms = (programs: Record<string, string[]>): ExtensionManifest =>
  manifestOf(ACTIONS, "1.0", {
    programs: Object.fromEntries(Object.entries(programs).map(([id, found]) => [id, { [process.platform]: found }])),
  });
const execs = async (fixture: RunningExtension, requests: unknown[]): Promise<unknown> =>
  codeOf(await run(fixture, "exec", undefined, { requests }));

test("host/exec runs a program its manifest names, found by the host, without a shell and in a clean environment", async () => {
  vi.stubEnv("CEDARLOOM_TEST_TOKEN", "secret");
  vi.stubEnv("CLAUDE_CONFIG_DIR", "/elsewhere");
  const fixture = await extension({ manifest: withPrograms({ node: ["node"] }) });
  const script =
    "process.stdout.write(JSON.stringify([process.argv[1], process.env.CEDARLOOM_TEST_TOKEN ?? null, process.env.CLAUDE_CONFIG_DIR ?? null, process.cwd()])); process.exit(3)";
  const answers = await execs(fixture, [
    { program: "node", args: ["-e", script, "$(id); echo x"] },
    { program: "git" },
  ]);
  vi.unstubAllEnvs();
  expect(answers).toEqual({
    answers: [
      { result: { code: 3, stdout: JSON.stringify(["$(id); echo x", null, null, homedir()]), stderr: "" } },
      { error: { code: HOST_REFUSED, message: "no program git in the manifest" } },
    ],
  });
});

test("host/exec stops a program at its time limit and at its output cap, and says when a program is not installed", async () => {
  const fixture = await extension({
    manifest: withPrograms({ node: ["node"], absent: ["cedarloom-no-such-program"] }),
    limits: { execBytes: 1000 },
  });
  // The time limit is the first request's own, so a slow start of node never stops the second before its output.
  const answers = await execs(fixture, [
    { program: "node", args: ["-e", "setTimeout(() => {}, 10000)"], timeoutMs: 300 },
    { program: "node", args: ["-e", "process.stdout.write('x'.repeat(5000))"] },
    { program: "absent" },
  ]);
  expect(answers).toEqual({
    answers: [
      { error: { code: HOST_FAILED, message: "stopped at the time limit of 300 ms" } },
      { error: { code: HOST_FAILED, message: "stopped at the output cap of 1000 bytes" } },
      { error: { code: HOST_MISSING, message: "absent is not installed: none of cedarloom-no-such-program found" } },
    ],
  });
});

test.skipIf(process.platform === "win32")(
  "host/exec finds a program in the user's home folder, which a desktop app's PATH lacks",
  async () => {
    const home = mkdtempSync(join(scratch, "home-"));
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    const tool = join(home, ".local", "bin", "tool");
    writeFileSync(tool, "#!/bin/sh\necho from home\n", { mode: 0o755 });
    vi.stubEnv("HOME", home);
    const fixture = await extension({
      manifest: withPrograms({ tool: ["cedarloom-no-such-program", "~/.local/bin/tool"] }),
    });
    const answers = await execs(fixture, [{ program: "tool" }]);
    vi.unstubAllEnvs();
    expect(answers).toEqual({ answers: [{ result: { code: 0, stdout: "from home\n", stderr: "" } }] });
  },
);

test("an extension from elsewhere that names programs is refused, since a program runs outside every sandbox", async () => {
  const wraps = {
    wrap: (launch: Parameters<NonNullable<ExtensionLaunch["sandbox"]>["wrap"]>[0]) => Promise.resolve(launch),
  };
  const result = await start({
    manifest: withPrograms({ node: ["node"] }),
    trust: "community",
    platform: "linux",
    sandbox: wraps,
  });
  expect(result.ok ? "started" : result.finding).toEqual(refusal("programs"));
});

test.skipIf(process.platform === "win32")(
  "host/exec stops a program's whole tree at its limit and answers at once",
  async () => {
    // The shell exits at once; its background child holds the output open and would run on for 30 s.
    const pidFile = join(scratch, "background.pid");
    const fixture = await extension({ manifest: withPrograms({ sh: ["sh"] }), limits: { execMs: 500 } });
    const begun = Date.now();
    const answers = await execs(fixture, [
      { program: "sh", args: ["-c", `sleep 30 & echo $! > '${pidFile}'; echo started`] },
    ]);
    const answeredIn = Date.now() - begun;
    expect([answers, answeredIn < 5000]).toEqual([
      { answers: [{ error: { code: HOST_FAILED, message: "stopped at the time limit of 500 ms" } }] },
      true,
    ]);
    // A killed process is gone once init has reaped it, shortly after.
    const background = Number(readFileSync(pidFile, "utf8"));
    await vi.waitFor(() => expect(() => process.kill(background, 0)).toThrow("ESRCH"), { timeout: 3000 });
  },
);

test.runIf(process.platform === "win32")(
  "host/exec finds a program on a Windows search path spelled Path",
  async () => {
    const path = process.env["PATH"] ?? "";
    delete process.env["PATH"];
    process.env["Path"] = path;
    try {
      const fixture = await extension({ manifest: withPrograms({ node: ["node"] }) });
      const answers = await execs(fixture, [{ program: "node", args: ["-e", "process.stdout.write('found')"] }]);
      expect(answers).toEqual({ answers: [{ result: { code: 0, stdout: "found", stderr: "" } }] });
    } finally {
      delete process.env["Path"];
      process.env["PATH"] = path;
    }
  },
);

test("host/exec refuses an argument with a NUL, which no program can take", async () => {
  const fixture = await extension({ manifest: withPrograms({ node: ["node"] }) });
  expect(await execs(fixture, [{ program: "node", args: ["-e", "1", "a\u0000b"] }])).toEqual({
    answers: [{ error: { code: HOST_REFUSED, message: "invalid request" } }],
  });
});

test.runIf(process.platform === "win32")("host/exec finds a candidate named with its .exe as named", async () => {
  const fixture = await extension({ manifest: withPrograms({ node: ["node.exe"] }) });
  const answers = await execs(fixture, [{ program: "node", args: ["-e", "process.stdout.write('found')"] }]);
  expect(answers).toEqual({ answers: [{ result: { code: 0, stdout: "found", stderr: "" } }] });
});

// A doctor run that ended without findings of the extension's own.
const unanswered = (error: string) => ({
  code: "extension.failed",
  params: { extension: "acme.fixture", step: "doctor", error },
});

test("the doctor asks an extension's own checks once and shows their texts safely; no answer in time is a finding", async () => {
  const plain = manifestOf(ACTIONS);
  const checked = ExtensionManifest.parse({
    ...plain,
    contributes: { ...plain.contributes, doctor: { fixture: { title: "Fixture" } } },
  });
  const ask = async (more: Partial<ExtensionLaunch>) => (await extension({ manifest: checked, ...more })).doctor();
  expect([
    await ask({}),
    await ask({ locale: "x-slow-doctor", limits: { doctorMs: 200 } }),
    await ask({ locale: "x-other-check" }),
    await (await extension()).doctor(),
  ]).toEqual([
    [
      {
        code: "extension.finding",
        params: {
          extension: "acme.fixture",
          check: "fixture",
          severity: "warning",
          code: "fixture.checked",
          message: "checked\\u001b[2K",
        },
      },
    ],
    [unanswered("no answer within 200 ms")],
    [unanswered("an answer the host refuses")],
    [],
  ]);
});

// The fixture as a switch target for Claude Code's interactive account.
const switching = (): ExtensionManifest => {
  const plain = manifestOf(ACTIONS);
  const switchTargets = { interactive: { agent: "claude" } };
  return ExtensionManifest.parse({ ...plain, contributes: { ...plain.contributes, switchTargets } });
};
const INTERACTIVE = { target: "interactive" };

test("a switch target answers each call within its contract, its accounts by number, an alias only where one is set", async () => {
  const fixture = await extension({ manifest: switching() });
  const answers = [
    await fixture.target("target/probe", INTERACTIVE),
    await fixture.target("target/accounts", INTERACTIVE),
    await fixture.target("target/current", INTERACTIVE),
    await fixture.target("target/select", { ...INTERACTIVE, number: 2 }),
    await fixture.target("target/tick", INTERACTIVE),
    await fixture.target("target/policy", { ...INTERACTIVE, set: { "autoswitch.cooldown": "600" } }),
  ];
  const when = "2026-11-07T10:00:00.000Z";
  const window = { window: "fiveHour", usedPercent: 91, resetsAt: when, readAt: when };
  expect(answers.map(codeOf)).toEqual([
    { status: "supported", detail: "cswap 1.2.3" },
    {
      accounts: [
        { number: 1, alias: "work", active: true, disabled: false, held: false, threshold: 90, windows: [window] },
        { number: 2, active: false, disabled: false, held: true, threshold: null, windows: [] },
      ],
    },
    { number: 1 },
    { switched: true, from: 1, to: 2, reason: "asked" },
    { code: 0, events: [{ at: when, from: 1, to: 2, reason: "over the line", trigger: "proactive" }] },
    { values: { "autoswitch.threshold": 90, "autoswitch.cooldown": "600" } },
  ]);
});

test("a call of an extension that is not the app's own, to a target the manifest does not name, with settings its answer could not hold, answered outside the contract, or not in time fails", async () => {
  const wraps = {
    wrap: (launch: Parameters<NonNullable<ExtensionLaunch["sandbox"]>["wrap"]>[0]) => Promise.resolve(launch),
  };
  const community = await extension({ manifest: switching(), trust: "community", platform: "darwin", sandbox: wraps });
  const fixture = await extension({ manifest: switching() });
  const bad = await extension({ manifest: switching(), locale: "x-bad-target" });
  const slow = await extension({ manifest: switching(), locale: "x-slow-target", limits: { targetMs: 200 } });
  expect([
    codeOf(await community.target("target/probe", INTERACTIVE)),
    codeOf(await fixture.target("target/probe", { target: "elsewhere" })),
    codeOf(await fixture.target("target/policy", { ...INTERACTIVE, set: { "autoswitch.note": "ring\u0007" } })),
    codeOf(await bad.target("target/probe", INTERACTIVE)),
    codeOf(await slow.target("target/current", INTERACTIVE)),
  ]).toEqual([
    failure("target", "switch targets are the app's own extensions' only"),
    failure("target", "no switch target elsewhere"),
    failure("target", "settings its answer could not hold"),
    failure("target", "an answer the host refuses"),
    failure("target", "no answer within 200 ms"),
  ]);
});
