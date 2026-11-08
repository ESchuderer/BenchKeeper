import { spawn } from "node:child_process";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
  ACTION_FAILED,
  type Action,
  defineExtension,
  doctorRun,
  type ExtensionOptions,
  exit,
  HOST_FAILED,
  hostExec,
  hostFetch,
  initialize,
  type LogParams,
  log,
  PROTOCOL,
  runAction,
  shutdown,
} from "@cedarloom/extension-sdk";
import {
  CancellationTokenSource,
  createMessageConnection,
  ErrorCodes,
  type MessageConnection,
  ResponseError,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node";
import { expect, test } from "vitest";

const aborted: unknown[] = [];
const kept: ((message: string) => void)[] = [];

const actions: Record<string, Action> = {
  echo: ({ config, inputs, run, locale, log: write }) => {
    write("started");
    write("almost done", "warning");
    return { config, inputs, run, locale };
  },
  fail: () => {
    throw new Error("the tracker answered 500");
  },
  // A library may reject with a plain value; its text is the reason.
  rejects: () => Promise.reject(Object.assign(Object.create(null), { toString: () => "a plain refusal" })),
  // A value with no text form at all.
  opaque: () => Promise.reject(Object.create(null)),
  // Outputs that are no object, that JSON turns into none, or that JSON cannot carry.
  text: () => Promise.resolve(Object("not an object")),
  json: () => ({ toJSON: () => 42 }),
  big: () => ({ count: 10n }),
  // Keeps its log for after the run, as a timer left behind would.
  later: ({ log: write }) => {
    kept.push(write);
    return {};
  },
  // Ends only by the host's cancel, also one that came before it started, and keeps the reason its signal got.
  wait: ({ signal, log: write }) =>
    new Promise((_, reject) => {
      const stop = (): void => {
        aborted.push(signal.reason);
        reject(signal.reason);
      };
      write("waiting");
      if (signal.aborted) stop();
      else signal.addEventListener("abort", stop);
    }),
  // Fetches through the host the request its configuration holds, and says what it was granted.
  fetch: async ({ config, fetch, granted }) => ({ answer: await fetch(Object(config)), granted }),
  granted: ({ granted }) => ({ granted }),
};

type Connected = { host: MessageConnection; toExtension: PassThrough; logs: LogParams[]; exited: Promise<number> };

/** The host's end of a connection to an extension on in-memory streams, the log lines it got, and its exit. */
const connect = (more: Pick<ExtensionOptions, "doctor"> = {}): Connected => {
  const [toExtension, toHost] = [new PassThrough(), new PassThrough()];
  const exited = Promise.withResolvers<number>();
  defineExtension(actions, { input: toExtension, output: toHost, onExit: exited.resolve, ...more });
  const host = createMessageConnection(new StreamMessageReader(toHost), new StreamMessageWriter(toExtension));
  const logs: LogParams[] = [];
  host.onNotification(log, (line) => {
    logs.push(line);
  });
  host.listen();
  return { host, toExtension, logs, exited: exited.promise };
};

const params = { config: { query: "x" }, inputs: { project: "CL" }, run: "r1" };
// A host that sends no grant grants nothing.
const hello = { protocol: PROTOCOL, locale: "de" };

test("the extension names its protocol version and actions, runs an action with its context, and logs to the host", async () => {
  const { host, logs } = connect();
  const answer = await host.sendRequest(initialize, hello);
  const ran = await host.sendRequest(runAction, { action: "echo", ...params });
  const grant = await host.sendRequest(runAction, { action: "granted", ...params });
  expect([answer, ran, grant, logs]).toEqual([
    {
      protocol: "1.0",
      actions: ["echo", "fail", "rejects", "opaque", "text", "json", "big", "later", "wait", "fetch", "granted"],
    },
    { outputs: { ...params, locale: "de" } },
    { outputs: { granted: { net: [], credentials: [] } } },
    [
      { run: "r1", level: "info", message: "started" },
      { run: "r1", level: "warning", message: "almost done" },
    ],
  ]);
});

test("an unknown action, an Object property among them, and an action that throws answer with a code and a reason", async () => {
  const { host } = connect();
  const answers = await Promise.all(
    ["nope", "constructor", "fail", "rejects", "opaque", "text", "json", "big"].map((action) =>
      host.sendRequest(runAction, { action, ...params }).then(
        () => "answered",
        (error: unknown) => [Reflect.get(Object(error), "code"), Reflect.get(Object(error), "message")],
      ),
    ),
  );
  expect(answers).toEqual([
    [ErrorCodes.InvalidParams, "no action nope"],
    [ErrorCodes.InvalidParams, "no action constructor"],
    [ACTION_FAILED, "the tracker answered 500"],
    [ACTION_FAILED, "a plain refusal"],
    [ACTION_FAILED, "the action failed"],
    [ACTION_FAILED, "an action returns an object of its outputs"],
    [ACTION_FAILED, "an action returns an object of its outputs"],
    [ACTION_FAILED, expect.stringMatching(/BigInt/)],
  ]);
});

const reason = (error: unknown): unknown => Reflect.get(Object(error), "message");

test("the host's cancel aborts the action's signal, also a cancel that comes before the action started", async () => {
  const { host } = connect();
  const early = new CancellationTokenSource();
  const before = host.sendRequest(runAction, { action: "wait", ...params, run: "early" }, early.token).catch(reason);
  early.cancel();
  // The other is cancelled once it says it waits (this handler takes the place of the one that collects lines).
  const late = new CancellationTokenSource();
  const during = host.sendRequest(runAction, { action: "wait", ...params, run: "late" }, late.token).catch(reason);
  host.onNotification(log, ({ run }) => {
    if (run === "late") late.cancel();
  });
  expect([await before, await during, aborted.map(String)]).toEqual([
    expect.stringMatching(/cancel/i),
    expect.stringMatching(/cancel/i),
    ["Error: cancelled by the host", "Error: cancelled by the host"],
  ]);
});

test("an action fetches through the host and knows its grant, and the run's cancel reaches the fetch", async () => {
  const { host } = connect();
  const granted = { net: ["https://api.example.com"], credentials: ["token"] };
  await host.sendRequest(initialize, { ...hello, granted });
  const run = new CancellationTokenSource();
  const cancelled: string[] = [];
  host.onRequest(hostFetch, (request, token) => {
    if (!request.url.endsWith("/slow")) return { status: 200, url: request.url, headers: {}, body: "ok" };
    run.cancel();
    return new Promise((resolve) =>
      token.onCancellationRequested(() => {
        cancelled.push(request.url);
        resolve(new ResponseError(HOST_FAILED, "the run was cancelled"));
      }),
    );
  });
  const request = { url: "https://api.example.com/a", method: "POST", body: "{}", credential: "token" };
  const fetched = await host.sendRequest(runAction, { action: "fetch", ...params, config: request });
  const slow = { action: "fetch", ...params, config: { url: "https://api.example.com/slow" } };
  const stopped = await host.sendRequest(runAction, slow, run.token).catch(reason);
  expect([fetched, stopped, cancelled]).toEqual([
    { outputs: { answer: { status: 200, url: request.url, headers: {}, body: "ok" }, granted } },
    expect.stringMatching(/cancel/i),
    ["https://api.example.com/slow"],
  ]);
});

test("the extension ends with code 0 after shutdown and exit, and with 1 on exit alone or when its input closes", async () => {
  const clean = connect();
  await clean.host.sendRequest(shutdown);
  await clean.host.sendNotification(exit);
  const abrupt = connect();
  await abrupt.host.sendNotification(exit);
  // A host that crashed sends nothing more: its end of the extension's input closes.
  const lost = connect();
  lost.toExtension.end();
  expect(await Promise.all([clean.exited, abrupt.exited, lost.exited])).toEqual([0, 1, 1]);
});

test("a log line after the host is gone is dropped, not thrown into the extension", async () => {
  const { host, exited } = connect();
  await host.sendRequest(runAction, { action: "later", ...params });
  await host.sendNotification(exit);
  await exited;
  expect(() => kept[0]?.("too late")).not.toThrow();
});

// One message on the wire, as the protocol's base layer frames it.
const frame = (body: string): string => `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;

test("malformed frames crash nothing: a broken frame gets no answer, a run with params null -32603, and the next run is answered", async () => {
  const { host, toExtension } = connect();
  toExtension.write(frame("{not json"));
  toExtension.write(frame('{"jsonrpc":"2.0","id":901,"method":"action/run","params":null}'));
  toExtension.write(frame('{"no":"json-rpc"}'));
  toExtension.write("X-Header: without a length\r\n\r\n");
  const ran = await host.sendRequest(runAction, { action: "echo", ...params });
  expect(ran.outputs["run"]).toBe("r1");
});

test("an extension on its real stdio keeps every other write off standard output, and exits on the host's exit", async () => {
  const child = spawn(process.execPath, [join(import.meta.dirname, "fixtures", "extension.mjs")], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  const host = createMessageConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin));
  host.listen();
  await host.sendRequest(initialize, { ...hello, locale: "en" });
  const ran = await host.sendRequest(runAction, { action: "greet", config: {}, inputs: { name: "Ada" }, run: "r2" });
  await host.sendRequest(shutdown);
  // `close`, not `exit`: standard error may still hold output when the process has exited.
  const code = new Promise((resolve) => child.once("close", resolve));
  await host.sendNotification(exit);
  expect([ran, await code, stderr]).toEqual([
    { outputs: { greeting: "Hello, Ada" } },
    0,
    expect.stringMatching(/a stray line for standard output[\s\S]*stray: 'object'[\s\S]*a stray write/),
  ]);
}, 30_000);

// A check whose text is the language it was asked in.
const doctor: ExtensionOptions["doctor"] = async ({ locale, exec }) => {
  const { stdout } = await exec({ program: "tool", args: ["--version"] });
  return [{ check: "setup", severity: "info", code: "example.language", message: `${locale} ${stdout}` }];
};

test("the doctor's checks run in the language initialize named and run programs through the host, and an extension without checks has none", async () => {
  const { host } = connect({ doctor });
  host.onRequest(hostExec, ({ program, args }) => ({
    code: 0,
    stdout: [program, ...(args ?? [])].join(" "),
    stderr: "",
  }));
  await host.sendRequest(initialize, hello);
  const plain = connect().host;
  await plain.sendRequest(initialize, hello);
  expect([await host.sendRequest(doctorRun), await plain.sendRequest(doctorRun)]).toEqual([
    { findings: [{ check: "setup", severity: "info", code: "example.language", message: "de tool --version" }] },
    { findings: [] },
  ]);
});
