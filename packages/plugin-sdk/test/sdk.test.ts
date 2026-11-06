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
  echo: ({ config, inputs, run, log: write }) => {
    write("started");
    write("almost done", "warning");
    return { config, inputs, run };
  },
  fail: () => {
    throw new Error("the tracker answered 500");
  },
  // A library may reject with a plain value; its text is the reason.
  rejects: () => Promise.reject(Object.assign(Object.create(null), { toString: () => "a plain refusal" })),
  // Ends only by the host's cancel, and keeps the reason its signal got.
  wait: ({ signal }) =>
    new Promise((_, reject) => {
      signal.addEventListener("abort", () => {
        aborted.push(signal.reason);
        reject(signal.reason);
      });
    }),
};

/** The host's end of a connection to a plugin on in-memory streams, the log lines it got, and whether it exited. */
const connect = (): { host: MessageConnection; logs: LogParams[]; exited: () => boolean } => {
  const [toPlugin, toHost] = [new PassThrough(), new PassThrough()];
  let exited = false;
  definePlugin(actions, { input: toPlugin, output: toHost, onExit: () => (exited = true) });
  const host = createMessageConnection(new StreamMessageReader(toHost), new StreamMessageWriter(toPlugin));
  const logs: LogParams[] = [];
  host.onNotification(log, (line) => {
    logs.push(line);
  });
  host.listen();
  return { host, logs, exited: () => exited };
};

const params = { config: { query: "x" }, inputs: { project: "CL" }, run: "r1" };

test("the plugin names its protocol version and actions, runs an action with its context, and logs to the host", async () => {
  const { host, logs } = connect();
  const hello = await host.sendRequest(initialize, { protocol: PROTOCOL, locale: "de" });
  const ran = await host.sendRequest(runAction, { action: "echo", ...params });
  expect([hello, ran, logs]).toEqual([
    { protocol: "1.0", actions: ["echo", "fail", "rejects", "wait"] },
    { outputs: params },
    [
      { level: "info", message: "started" },
      { level: "warning", message: "almost done" },
    ],
  ]);
});

test("an unknown action, an Object property among them, and an action that throws answer with a code and a reason", async () => {
  const { host } = connect();
  const answers = await Promise.all(
    ["nope", "constructor", "fail", "rejects"].map((action) =>
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
  ]);
});

test("the host's cancel aborts the action's signal, and the run ends with the reason", async () => {
  const { host } = connect();
  const source = new CancellationTokenSource();
  const running = host.sendRequest(runAction, { action: "wait", ...params }, source.token).then(
    () => "answered",
    (error: unknown) => Reflect.get(Object(error), "message"),
  );
  setTimeout(() => source.cancel(), 20);
  expect([await running, String(aborted[0])]).toEqual([
    expect.stringMatching(/cancel/i),
    "Error: cancelled by the host",
  ]);
});

test("shutdown answers, and exit ends the plugin", async () => {
  const { host, exited } = connect();
  const answer = await host.sendRequest(shutdown);
  await host.sendNotification(exit);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect([answer, exited()]).toEqual([null, true]);
});

test("a plugin on its real stdio keeps console.log off standard output, and exits on the host's exit", async () => {
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
  const code = new Promise((resolve) => child.once("exit", resolve));
  await host.sendNotification(exit);
  expect([ran, await code, stderr]).toEqual([
    { outputs: { greeting: "Hello, Ada" } },
    0,
    expect.stringContaining("a stray line for standard output"),
  ]);
}, 30_000);
