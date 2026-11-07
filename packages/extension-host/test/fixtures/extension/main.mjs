// An extension as its folder holds it: nothing beside it to import, so it speaks the protocol itself (Content-Length
// frames over stdio). Its locale picks a misbehavior: x-old speaks protocol 0.9, x-garbled no version at all,
// x-fewer names fewer actions, x-noactions no list of them, x-deep a deeply nested one, x-silent never answers the
// handshake, x-deaf ignores exit.
import { spawnSync } from "node:child_process";
import { lookup } from "node:dns/promises";
import { fstatSync, readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { isatty } from "node:tty";
import { Worker } from "node:worker_threads";

let mode = "";
let granted;
let input = Buffer.alloc(0);
const pending = new Map();
let asked = 0;

const send = (message) => {
  const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }));
  process.stdout.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]));
};

// Asks the host and answers its result or its error.
const ask = (method, params) =>
  new Promise((resolve) => {
    const id = `h${(asked += 1)}`;
    pending.set(id, ({ result, error }) =>
      resolve(error ? { error: { code: error.code, message: error.message } } : { result }),
    );
    send({ id, method, params });
  });

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

// Node's flags do not cover a descriptor a process was given: none past stdio may be a file, a socket or a terminal.
// Node opens descriptors of its own: pipes for its event loop, on Linux a device such as /dev/urandom, on macOS folders,
// which a plain node process has too.
const inherited = () => {
  for (let fd = 3; fd < 1024; fd += 1) {
    const kind = attemptSync(() => fstatSync(fd));
    if (kind?.isFile() || kind?.isSocket() || isatty(fd)) return `descriptor ${fd}`;
  }
  return "none";
};
const attemptSync = (act) => {
  try {
    return act();
  } catch {
    return undefined;
  }
};

const actions = {
  echo: ({ config, inputs, run }) => ({ config, inputs, run }),
  chatty: ({ run }) => {
    for (const [index, level] of ["loud", "warning", "error", "info"].entries()) {
      send({ method: "host/log", params: { run, level, message: `line\u001b ${index} ${"x".repeat(20)}` } });
    }
    send({ method: "host/log", params: { run: "another run", level: "info", message: "not this run's" } });
    return {};
  },
  "call-host": async () => ({ code: (await ask("host/exec", { command: "id" })).error?.code }),
  // Sends the requests its node's `with` lists at once, and the host's grant.
  fetch: async ({ config }) => ({
    answers: await Promise.all(config.requests.map((r) => ask("host/fetch", r))),
    granted,
  }),
  // Asks the host for a request that never answers, then ends.
  "fetch-then-crash": () => {
    send({ id: "hang", method: "host/fetch", params: { url: "https://api.acme.example/hang" } });
    setTimeout(() => process.exit(3), 50);
    return new Promise(() => undefined);
  },
  // Cancels requests the host is still handling, as the SDK does for a cancelled run: the cancel goes out once the host
  // has had time to start on the request.
  "fetch-cancel": async ({ config }) => {
    for (let index = 0; index < config.count; index += 1) {
      const id = `c${index}`;
      const answered = new Promise((resolve) => pending.set(id, resolve));
      send({ id, method: "host/fetch", params: { url: "https://api.acme.example/slow" } });
      await new Promise((resolve) => setTimeout(resolve, 5));
      send({ method: "$/cancelRequest", params: { id } });
      await answered;
    }
    return {};
  },
  oversize: () => {
    process.stdout.write(`Content-Length: ${64 * 1024 * 1024}\r\n\r\n`);
    return new Promise(() => undefined);
  },
  crash: () => process.exit(3),
  "bad-outputs": () => 42,
  refuse: () => {
    throw new Error("the tracker refused\u001b[2K\u202e");
  },
  // Ignores the host's cancel and never answers.
  stubborn: () => new Promise(() => undefined),
  // Stops reading its input, so the host's answers pile up, and sends requests at a steady rate: few enough at a time
  // that the host reads each batch at once, so only the answers it cannot write stay unread.
  "request-flood": async () => {
    process.stdin.pause();
    for (let batch = 0; batch < 300; batch += 1) {
      for (let index = 0; index < 20; index += 1) send({ id: `f${batch}-${index}`, method: "host/fetch", params: {} });
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    return {};
  },
  // Sends more small frames than the host reads at once, then answers.
  flood: () => {
    for (let index = 0; index < 20_000; index += 1) send({ method: "host/log", params: { run: "x", message: "." } });
    return {};
  },
  abuse: async ({ config }) => ({
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
    dns: await attempt(() => lookup("example.org")),
    fetch: await attempt(() => fetch("http://127.0.0.1:9/")),
    addon: await attempt(() => process.dlopen({ exports: {} }, join(import.meta.dirname, "addon.node"))),
    descriptor: inherited(),
    sqlite: await attempt(async () => {
      const { DatabaseSync } = await import("node:sqlite");
      return new DatabaseSync(join(import.meta.dirname, "..", "written.db"));
    }),
    signal: await attempt(() => process.kill(config.host, 0)),
    environment: Object.keys(process.env).filter((name) => !["LANG", "LC_ALL", "TZ"].includes(name)),
  }),
};

// Waits for the host's cancel, then answers with outputs anyway, as an action that ignores its signal would.
const waiting = new Map();
actions.wait = ({ run }) => new Promise((resolve) => waiting.set(run, () => resolve({ late: true })));

const requests = {
  initialize: ({ locale, granted: given }) => {
    mode = locale;
    granted = given;
    if (mode === "x-silent") return new Promise(() => undefined);
    const names = Object.keys(actions).filter((name) => mode !== "x-fewer" || name !== "abuse");
    const protocol = { "x-old": "0.9", "x-garbled": "one" }[mode] ?? "1.0";
    const deep = JSON.parse(`${"[".repeat(5000)}${"]".repeat(5000)}`);
    return { protocol, actions: { "x-noactions": "all", "x-deep": [deep] }[mode] ?? names };
  },
  "action/run": async (params) => ({ outputs: await actions[params.action](params) }),
  shutdown: () => null,
};

// An error whose message is an array nested 200,000 deep: the reader cannot build its answer.
const DEEP = Symbol("deep");
const answerDeep = (id) => {
  const body = `{"jsonrpc":"2.0","id":${JSON.stringify(id)},"error":{"code":1,"message":${"[".repeat(200_000)}${"]".repeat(200_000)}}}`;
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
};
actions["deep-error"] = () => {
  throw DEEP;
};

const specials = {
  exit: () => {
    if (mode !== "x-deaf") process.exit(0);
  },
  "$/cancelRequest": () => {
    for (const answer of waiting.values()) answer();
  },
};

const handle = async (message) => {
  const special = message.method === undefined ? () => pending.get(message.id)?.(message) : specials[message.method];
  if (special !== undefined) {
    special();
    return;
  }
  if (message.id === undefined) return;
  try {
    send({ id: message.id, result: await requests[message.method](message.params) });
  } catch (error) {
    if (error === DEEP) answerDeep(message.id);
    else send({ id: message.id, error: { code: 1, message: error.message } });
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
