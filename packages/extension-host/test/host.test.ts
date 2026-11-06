import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { PluginManifest, type Result } from "@cedarloom/contracts";
import { type ExtensionLaunch, framesUpTo, type RunningExtension, startExtension } from "@cedarloom/extension-host";
import { afterAll, afterEach, expect, test } from "vitest";
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
  "abuse",
  "wait",
];
const manifestOf = (actions: string[], api = "1.0"): PluginManifest =>
  PluginManifest.parse({
    schemaVersion: 1,
    kind: "cedarloom.plugin",
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
const run = (target: RunningExtension, action: string, signal?: AbortSignal) =>
  target.run({ action, config: { query: "x" }, inputs: { project: "CL" }, run: `r-${action}` }, signal);
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
  expect([kit, Reflect.get(Object(kit), "signal") === SANDBOX_ONLY.signal]).toEqual([CONFORMANT, false]);
});

test("the host answers no call of the extension but host/log: any other is a method that does not exist", async () => {
  expect(codeOf(await run(await extension(), "call-host"))).toEqual({ code: -32601 });
});

test("an extension is refused for another protocol, other actions, an old Node, or a trust this machine cannot confine", async () => {
  const wraps = { wrap: (launch: Parameters<NonNullable<ExtensionLaunch["sandbox"]>["wrap"]>[0]) => launch };
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

// A copy of the fixture's folder under `name` in the scratch folder, with a link to `/` inside when asked.
const copyOf = (name: string, link = false): string => {
  const copy = join(scratch, name);
  mkdirSync(copy);
  copyFileSync(join(folder, "main.mjs"), join(copy, "main.mjs"));
  if (link) symlinkSync(join(copy, ".."), join(copy, "outside"));
  return copy;
};

test.skipIf(process.platform === "win32")(
  "a folder that would widen the grant is refused: a * or ? in its path, a link inside",
  async () => {
    const results = await Promise.all([
      start({ folder: copyOf("with*star") }),
      start({ folder: copyOf("with?mark") }),
      start({ folder: copyOf("with-link", true) }),
      start({ folder: copyOf("plain") }),
    ]);
    expect(results.map((result) => (result.ok ? "started" : result.finding))).toEqual([
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

test("S10: a flood of small frames past the unread bound ends the extension", async () => {
  const flooded = await extension({ limits: { unreadMessages: 200 } });
  expect(codeOf(await run(flooded, "flood"))).toEqual(failure("run", "over 200 messages unread"));
});

test("an extension that does not start or answer fails with the reason and ends, and one that ignores exit is killed", async () => {
  const gone = PluginManifest.parse({ ...manifestOf(ACTIONS), runtime: { kind: "node", entry: "gone.mjs" } });
  const nowhere = { wrap: () => ({ command: join(folder, "no-such-program"), args: [], cwd: folder, env: {} }) };
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
