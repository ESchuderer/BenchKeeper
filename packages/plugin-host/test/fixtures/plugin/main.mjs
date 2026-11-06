// A plugin as its folder holds it: nothing beside it to import, so it speaks the protocol itself (Content-Length
// frames over stdio). Its locale picks a misbehavior: x-old speaks protocol 0.9, x-garbled no version at all,
// x-fewer names fewer actions, x-noactions no list of them, x-silent never answers the handshake, x-deaf ignores exit.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

let mode = "";
let input = Buffer.alloc(0);
const pending = new Map();

const send = (message) => {
  const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }));
  process.stdout.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]));
};

// What one attempt the permission flags must stop answers: its error code, or "allowed".
const attempt = async (act) => {
  try {
    await act();
    return "allowed";
  } catch (error) {
    return error?.code ?? error?.cause?.code ?? String(error);
  }
};
const reach = () =>
  new Promise((resolve, reject) => {
    const socket = connect(9, "127.0.0.1");
    socket.on("error", reject);
    socket.on("connect", resolve);
  });

const actions = {
  echo: ({ config, inputs, run }) => ({ config, inputs, run }),
  chatty: ({ run }) => {
    for (const [index, level] of ["loud", "warning", "error", "info"].entries()) {
      send({ method: "host/log", params: { run, level, message: `line ${index} ${"x".repeat(20)}` } });
    }
    send({ method: "host/log", params: { run: "another run", level: "info", message: "not this run's" } });
    return {};
  },
  "call-host": () =>
    new Promise((resolve) => {
      pending.set("h1", (answer) => resolve({ code: answer.error?.code }));
      send({ id: "h1", method: "host/fetch", params: { url: "https://example.org" } });
    }),
  oversize: () => {
    process.stdout.write(`Content-Length: ${64 * 1024 * 1024}\r\n\r\n`);
    return new Promise(() => undefined);
  },
  crash: () => process.exit(3),
  "bad-outputs": () => 42,
  refuse: () => {
    throw new Error("the tracker refused");
  },
  abuse: async () => ({
    write: await attempt(() => writeFileSync(join(import.meta.dirname, "written.txt"), "x")),
    writeOutside: await attempt(() => writeFileSync(join(import.meta.dirname, "..", "written.txt"), "x")),
    readOutside: await attempt(() => readFileSync(join(import.meta.dirname, "..", "..", "tsconfig.json"))),
    readOwn: await attempt(() => readFileSync(join(import.meta.dirname, "main.mjs"))),
    spawn: await attempt(() => {
      const ran = spawnSync(process.execPath, ["-e", "1"]);
      if (ran.error) throw ran.error;
    }),
    worker: await attempt(() => new Worker("process.exit(0)", { eval: true })),
    network: await attempt(reach),
    environment: Object.keys(process.env).filter((name) => !["LANG", "LC_ALL", "TZ"].includes(name)),
  }),
};

// Waits for the host's cancel, then answers with outputs anyway, as an action that ignores its signal would.
const waiting = new Map();
actions.wait = ({ run }) => new Promise((resolve) => waiting.set(run, () => resolve({ late: true })));

const requests = {
  initialize: ({ locale }) => {
    mode = locale;
    if (mode === "x-silent") return new Promise(() => undefined);
    const names = Object.keys(actions).filter((name) => mode !== "x-fewer" || name !== "abuse");
    const protocol = { "x-old": "0.9", "x-garbled": "one" }[mode] ?? "1.0";
    return { protocol, actions: mode === "x-noactions" ? "all" : names };
  },
  "action/run": async (params) => ({ outputs: await actions[params.action](params) }),
  shutdown: () => null,
};

const handle = async (message) => {
  if (message.method === undefined) pending.get(message.id)?.(message);
  else if (message.method === "exit") {
    if (mode !== "x-deaf") process.exit(0);
  } else if (message.method === "$/cancelRequest") {
    for (const answer of waiting.values()) answer();
  } else if (message.id !== undefined) {
    try {
      send({ id: message.id, result: await requests[message.method](message.params) });
    } catch (error) {
      send({ id: message.id, error: { code: 1, message: error.message } });
    }
  }
};

process.stdin.on("data", (chunk) => {
  input = Buffer.concat([input, chunk]);
  for (;;) {
    const end = input.indexOf("\r\n\r\n");
    if (end < 0) return;
    const length = Number(/Content-Length: (\d+)/.exec(input.subarray(0, end).toString())[1]);
    if (input.length < end + 4 + length) return;
    const body = input.subarray(end + 4, end + 4 + length).toString();
    input = input.subarray(end + 4 + length);
    void handle(JSON.parse(body));
  }
});
