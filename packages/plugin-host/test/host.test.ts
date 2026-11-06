import { join } from "node:path";
import { PassThrough } from "node:stream";
import { PluginManifest, type Result } from "@cedarloom/contracts";
import { framesUpTo, type PluginLaunch, type RunningPlugin, startPlugin } from "@cedarloom/plugin-host";
import { afterEach, expect, test } from "vitest";
import { CONFORMANT, conformance } from "./conformance.ts";

const ACTIONS = ["echo", "chatty", "call-host", "oversize", "crash", "bad-outputs", "refuse", "abuse", "wait"];
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
const folder = join(import.meta.dirname, "fixtures", "plugin");

const started: RunningPlugin[] = [];
afterEach(async () => {
  await Promise.all(started.splice(0).map((plugin) => plugin.stop()));
});

const start = async (more: Partial<PluginLaunch> = {}): Promise<Result<RunningPlugin>> => {
  const result = await startPlugin({ manifest: manifestOf(ACTIONS), folder, tier: "bundled", locale: "en", ...more });
  if (result.ok) started.push(result.value);
  return result;
};
const plugin = async (more: Partial<PluginLaunch> = {}): Promise<RunningPlugin> => {
  const result = await start(more);
  if (!result.ok) throw new Error(result.finding.code);
  return result.value;
};
const run = (target: RunningPlugin, action: string, signal?: AbortSignal) =>
  target.run({ action, config: { query: "x" }, inputs: { project: "CL" }, run: `r-${action}` }, signal);
const codeOf = (result: Result<unknown>): unknown => (result.ok ? result.value : result.finding);

test("a bundled plugin starts under the permission flags, runs an action, and keeps bounded log lines of its runs", async () => {
  const fixture = await plugin({ limits: { logLines: 3, logChars: 10 } });
  await run(fixture, "echo");
  const echoed = await run(fixture, "echo");
  await run(fixture, "chatty");
  expect([codeOf(echoed), fixture.log("r-chatty"), fixture.log("another run")]).toEqual([
    { config: { query: "x" }, inputs: { project: "CL" }, run: "r-echo" },
    {
      lines: [
        { run: "r-chatty", level: "info", message: "line 0 xxx" },
        { run: "r-chatty", level: "warning", message: "line 1 xxx" },
        { run: "r-chatty", level: "error", message: "line 2 xxx" },
      ],
      dropped: 1,
    },
    { lines: [], dropped: 0 },
  ]);
});

test("the conformance kit: no write, no child process, worker or network, no read outside its folder, no environment", async () => {
  expect(codeOf(await conformance(await plugin()))).toEqual(CONFORMANT);
});

test("the host answers no call of the plugin but host/log: any other is a method that does not exist", async () => {
  expect(codeOf(await run(await plugin(), "call-host"))).toEqual({ code: -32601 });
});

const refusal = (reason: string): unknown => ({ code: "plugin.refused", params: { plugin: "acme.fixture", reason } });

test("a plugin is refused for another protocol, other actions, or a tier this machine cannot confine (P1 a, A31)", async () => {
  const wraps = { wrap: (launch: Parameters<NonNullable<PluginLaunch["sandbox"]>["wrap"]>[0]) => launch };
  const results = await Promise.all([
    start({ manifest: manifestOf(ACTIONS, "2.0") }),
    start({ manifest: manifestOf(ACTIONS, "1.1") }),
    start({ locale: "x-old" }),
    start({ locale: "x-garbled" }),
    start({ locale: "x-fewer" }),
    start({ locale: "x-noactions" }),
    start({ manifest: manifestOf([...ACTIONS, "more"]) }),
    start({ tier: "community", platform: "linux" }),
    start({ tier: "community", platform: "win32", sandbox: wraps }),
    start({ tier: "community", platform: "darwin", sandbox: wraps }),
  ]);
  expect(results.map((result) => (result.ok ? "started" : result.finding))).toEqual([
    ...["protocol", "protocol", "protocol", "protocol", "actions", "actions", "actions"].map(refusal),
    ...["sandbox-unavailable", "windows"].map(refusal),
    "started",
  ]);
});

const failure = (error: unknown) => ({ code: "plugin.failed", params: { plugin: "acme.fixture", step: "run", error } });

test("a run fails on an oversize message, a crash, an answer without outputs, its refusal, or the host's cancel", async () => {
  const cancel = new AbortController();
  const fixtures = await Promise.all([plugin(), plugin(), plugin(), plugin(), plugin()]);
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
    failure("a message over 1048576 bytes"),
    failure(expect.any(String)),
    failure("no outputs"),
    failure("cancelled by the host"),
    failure("the tracker refused"),
  ]);
});

const handshake = (error: unknown) => ({
  code: "plugin.failed",
  params: { plugin: "acme.fixture", step: "initialize", error },
});

test("a plugin that does not start or answer fails its handshake with the reason, and one that ignores exit is killed", async () => {
  const gone = PluginManifest.parse({ ...manifestOf(ACTIONS), runtime: { kind: "node", entry: "gone.mjs" } });
  const nowhere = { wrap: () => ({ command: join(folder, "no-such-program"), args: [], cwd: folder, env: {} }) };
  const failures = await Promise.all([
    start({ manifest: gone }),
    start({ locale: "x-silent", limits: { startMs: 200 } }),
    start({ tier: "community", platform: "linux", sandbox: nowhere }),
  ]);
  const deaf = await plugin({ locale: "x-deaf", limits: { stopMs: 100 } });
  const began = Date.now();
  await deaf.stop();
  expect([...failures.map(codeOf), Date.now() - began < 2000]).toEqual([
    handshake(expect.stringMatching(/gone\.mjs/)),
    handshake("no answer to the handshake"),
    handshake(expect.stringMatching(/ENOENT/)),
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

test("the frame guard passes frames split anywhere, and ends at a long header, a missing length or a large frame", async () => {
  const frames = "Content-Length: 2\r\n\r\n{}Content-Length: 3\r\n\r\n[1]";
  const results = await Promise.all([
    through(10, frames.split("")),
    through(10, [`X-Long: ${"x".repeat(1100)}`]),
    through(10, ["X-Other: 1\r\n\r\n{}"]),
    through(10, ["Content-Length: 11\r\n\r\n"]),
  ]);
  expect(results).toEqual([
    frames,
    "error: a frame header over 1024 bytes",
    "error: a frame without its Content-Length",
    "error: a message over 10 bytes",
  ]);
});
