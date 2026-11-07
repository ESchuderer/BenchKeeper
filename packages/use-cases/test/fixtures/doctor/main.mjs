// The smallest extension with a doctor check, an action and a switch target, speaking the protocol itself (Content-Length
// frames over stdio), since its folder holds nothing to import.
let input = Buffer.alloc(0);
const send = (message) => {
  const text = JSON.stringify({ ...message, jsonrpc: "2.0" });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`);
};
const answers = {
  initialize: () => ({ protocol: "1.0", actions: ["status"] }),
  // Its process id in the text, so a test can tell the process ended.
  "doctor/run": () => ({
    findings: [{ check: "setup", severity: "info", code: "example.ready", message: `ready ${process.pid}` }],
  }),
  "action/run": () => ({ outputs: { ready: true } }),
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
    if (message.id !== undefined) send({ id: message.id, result: answers[message.method]?.() ?? null });
  }
});
