import { spawn } from "node:child_process";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
  ACTION_FAILED,
  type Action,
  definePlugin,
  exit,
  initialize,
  type LogParams,
  log,
  PROTOCOL,
  runAction,
  shutdown,
} from "@cedarloom/plugin-sdk";
import {
  CancellationTokenSource,
  createMessageConnection,
  ErrorCodes,
  type MessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node";
import { expect, test } from "vitest";

const aborted: unknown[] = [];

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
  // Outputs that are no object, or that JSON cannot carry.
  text: () => Promise.resolve(Object("not an object")),
  big: () => ({ count: 10n }),
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
};

type Connected = { host: MessageConnection; logs: LogParams[]; exited: Promise<void> };

/** The host's end of a connection to a plugin on in-memory streams, the log lines it got, and its exit. */
const connect = (): Connected => {
  const [toPlugin, toHost] = [new PassThrough(), new PassThrough()];
  const exited = Promise.withResolvers<void>();
  definePlugin(actions, { input: toPlugin, output: toHost, onExit: exited.resolve });
  const host = createMessageConnection(new StreamMessageReader(toHost), new StreamMessageWriter(toPlugin));
  const logs: LogParams[] = [];
  host.onNotification(log, (line) => {
    logs.push(line);
  });
  host.listen();
  return { host, logs, exited: exited.promise };
};

const params = { config: { query: "x" }, inputs: { project: "CL" }, run: "r1" };

test("the plugin names its protocol version and actions, runs an action with its context, and logs to the host", async () => {
  const { host, logs } = connect();
  const hello = await host.sendRequest(initialize, { protocol: PROTOCOL, locale: "de" });
  const ran = await host.sendRequest(runAction, { action: "echo", ...params });
  expect([hello, ran, logs]).toEqual([
    { protocol: "1.0", actions: ["echo", "fail", "rejects", "text", "big", "wait"] },
    { outputs: { ...params, locale: "de" } },
    [
      { run: "r1", level: "info", message: "started" },
      { run: "r1", level: "warning", message: "almost done" },
    ],
  ]);
});

test("an unknown action, an Object property among them, and an action that throws answer with a code and a reason", async () => {
  const { host } = connect();
  const answers = await Promise.all(
    ["nope", "constructor", "fail", "rejects", "text", "big"].map((action) =>
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

test("shutdown answers, and exit ends the plugin", async () => {
  const { host, exited } = connect();
  const answer = await host.sendRequest(shutdown);
  await host.sendNotification(exit);
  expect([answer, await exited]).toEqual([null, undefined]);
});

test("a plugin on its real stdio keeps every other write off standard output, and exits on the host's exit", async () => {
  const child = spawn(process.execPath, [join(import.meta.dirname, "fixtures", "plugin.mjs")], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  const host = createMessageConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin));
  host.listen();
  await host.sendRequest(initialize, { protocol: PROTOCOL, locale: "en" });
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
