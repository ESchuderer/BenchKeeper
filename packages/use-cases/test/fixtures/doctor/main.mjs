import { existsSync, readFileSync } from "node:fs";

// The smallest extension with a doctor check, an action and a switch target, speaking the protocol itself (Content-Length
// frames over stdio), since its folder holds nothing to import. In a folder named cedarloom.orca, its actions are Orca's
// status, on a saved account, and follow, which follows once orca is allowed, or answers its folder's follow.json.
const orca = import.meta.url.includes("cedarloom.orca");
const followed = new URL("follow.json", import.meta.url);
let input = Buffer.alloc(0);
const send = (message) => {
  const text = JSON.stringify({ ...message, jsonrpc: "2.0" });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`);
};
const answers = {
  initialize: () => ({ protocol: "1.0", actions: orca ? ["status", "follow"] : ["status"] }),
  // Its process id in the text, so a test can tell the process ended.
  "doctor/run": () => ({
    findings: [{ check: "setup", severity: "info", code: "example.ready", message: `ready ${process.pid}` }],
  }),
  "action/run": ({ action, config }) => {
    if (!orca) return { outputs: { ready: true } };
    if (action === "status") return { outputs: { installed: true, running: true, claudeAccounts: "managed-other" } };
    if (existsSync(followed)) return { outputs: JSON.parse(readFileSync(followed, "utf8")) };
    return { outputs: { mode: "managed-other", followed: config.allow.includes("orca") } };
  },
  // claude-swap's three accounts, read just now: one by the alias work, one by another alias, one without.
  "target/probe": () => ({ status: "supported", detail: "fixture" }),
  "target/accounts": () => {
    const [readAt, resetsAt] = [new Date().toISOString(), new Date(Date.now() + 3_600_000).toISOString()];
    const account = (number, usedPercent, alias) => ({
      number,
      ...(alias === undefined ? {} : { alias }),
      active: number === 1,
      disabled: false,
      held: false,
      threshold: null,
      windows: [{ window: "fiveHour", usedPercent, resetsAt, readAt }],
    });
    return { accounts: [account(1, 40, "work"), account(2, 10, "elsewhere"), account(3, 20)] };
  },
  // Account 1 is active already; the policy echoes what it set.
  "target/select": ({ number }) => ({ switched: number !== 1, from: 1, to: number, reason: "asked" }),
  "target/policy": ({ set = {} }) => ({ values: { "autoswitch.threshold": 90, ...set } }),
  shutdown: () => null,
};
process.stdin.on("data", (chunk) => {
  input = Buffer.concat([input, chunk]);
  for (let end = input.indexOf("\r\n\r\n"); end >= 0; end = input.indexOf("\r\n\r\n")) {
    const length = Number(/Content-Length: (\d+)/.exec(input.subarray(0, end).toString())[1]);
    if (input.length < end + 4 + length) return;
    const message = JSON.parse(input.subarray(end + 4, end + 4 + length).toString());
    input = input.subarray(end + 4 + length);
    if (message.method === "exit") process.exit(0);
    if (message.id !== undefined) send({ id: message.id, result: answers[message.method]?.(message.params) ?? null });
  }
});
