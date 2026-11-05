// Stands in for the claude CLI: prints one line with its arguments, prompt and environment, then the stream-json file
// named by FAKE_STREAM, and exits with FAKE_EXIT; with FAKE_HANG it waits until it is killed, with FAKE_DEAF it exits
// at once without reading the prompt.
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write(`${process.env["FAKE_VERSION"] ?? "2.1.316 (Claude Code)"}\n`);
} else if (process.env["FAKE_DEAF"] !== undefined) {
  process.exitCode = 3;
} else {
  const prompt = readFileSync(0, "utf8");
  process.stdout.write(`${JSON.stringify({ type: "fake", args, prompt, env: process.env })}\n`);
  const stream = process.env["FAKE_STREAM"];
  if (stream !== undefined) process.stdout.write(readFileSync(stream, "utf8"));
  process.stderr.write("fake stderr\n");
  if (process.env["FAKE_HANG"] !== undefined) setInterval(() => undefined, 60_000);
  process.exitCode = Number(process.env["FAKE_EXIT"] ?? "0");
}
