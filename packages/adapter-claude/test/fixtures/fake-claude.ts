// Stands in for the claude CLI: answers --version and `auth status` (logged in); otherwise prints one line with its
// arguments, prompt and environment, then the stream-json file
// named by FAKE_STREAM, and exits with FAKE_EXIT; with FAKE_HANG it waits until it is killed, with FAKE_DEAF it exits
// at once without reading the prompt. FAKE_CHILD starts a command and prints its process ID, FAKE_LONG writes a line of
// that many bytes, FAKE_CUT a last line without its newline. FAKE_TICK writes a line every 20 ms until the fake ends, so
// with FAKE_HANG until it is killed. FAKE_RESULT names a file to write FAKE_RESULT_TEXT to, as a worker writes its
// result. FAKE_OTLP is an OTLP body it posts to the launch's telemetry receiver. FAKE_STUCK ignores SIGTERM, as a wedged
// CLI would.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write(`${process.env["FAKE_VERSION"] ?? "2.1.316 (Claude Code)"}\n`);
} else if (args.join(" ") === "auth status") {
  // Logged in with a subscription, in the folder it was asked about.
  const status = { loggedIn: true, authMethod: "claude.ai", configDirectory: process.env["CLAUDE_CONFIG_DIR"] };
  process.stdout.write(`${JSON.stringify(status)}\n`);
} else if (process.env["FAKE_DEAF"] !== undefined) {
  process.exitCode = 3;
} else {
  if (process.env["FAKE_STUCK"] !== undefined) process.on("SIGTERM", () => undefined);
  const prompt = readFileSync(0, "utf8");
  process.stdout.write(`${JSON.stringify({ type: "fake", pid: process.pid, args, prompt, env: process.env })}\n`);
  const stream = process.env["FAKE_STREAM"];
  if (stream !== undefined) process.stdout.write(readFileSync(stream, "utf8"));
  if (process.env["FAKE_CHILD"] !== undefined) {
    // Detached, so on Windows it stays out of the job object that libuv ends with the fake: only taskkill /T reaches it.
    const command = spawn(process.execPath, ["-e", "setInterval(() => undefined, 60_000)"], {
      stdio: "ignore",
      detached: true,
    });
    // Like the CLI on SIGTERM: stops the running command, then exits.
    process.on("SIGTERM", () => {
      command.once("exit", () => process.exit(143));
      command.kill();
    });
    process.stdout.write(`${JSON.stringify({ type: "command", pid: command.pid })}\n`);
  }
  // As Claude Code's exporter does, with the endpoint and the logs header the launch set.
  const otlp = process.env["FAKE_OTLP"];
  const endpoint = process.env["OTEL_EXPORTER_OTLP_LOGS_ENDPOINT"];
  if (otlp !== undefined && endpoint !== undefined) {
    const authorization = (process.env["OTEL_EXPORTER_OTLP_LOGS_HEADERS"] ?? "").replace(/^Authorization=/, "");
    await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization },
      body: otlp,
    });
  }
  const result = process.env["FAKE_RESULT"];
  if (result !== undefined) writeFileSync(result, process.env["FAKE_RESULT_TEXT"] ?? "");
  const long = process.env["FAKE_LONG"];
  if (long !== undefined) process.stdout.write(`${"x".repeat(Number(long))}\n`);
  process.stdout.write(process.env["FAKE_CUT"] ?? "");
  process.stderr.write("fake stderr\n");
  if (process.env["FAKE_HANG"] !== undefined) setInterval(() => undefined, 60_000);
  // A CLI that keeps streaming its run: a reader that closed stdout early would make this write fail with EPIPE.
  if (process.env["FAKE_TICK"] !== undefined) setInterval(() => process.stdout.write('{"type":"tick"}\n'), 20);
  process.exitCode = Number(process.env["FAKE_EXIT"] ?? "0");
}
