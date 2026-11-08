#!/usr/bin/env node
import { text as readAll } from "node:stream/consumers";
import { osKeyring } from "./keyring.ts";
import { main } from "./main.ts";

// Only a long-running command asks to be stopped, so Ctrl+C ends every other one as usual.
const untilStopped = (): Promise<void> =>
  new Promise((resolve) => {
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => resolve());
  });

process.exitCode = await main(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  env: process.env,
  untilStopped,
  stdin: async () => (process.stdin.isTTY ? null : readAll(process.stdin)),
  keyring: osKeyring,
});
