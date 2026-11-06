#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { main } from "./main.ts";

// The agent's own login in this terminal (https://code.claude.com/docs/en/cli-reference, `claude auth login`).
const login = (env: Record<string, string>) => {
  const ran = spawnSync("claude", ["auth", "login"], { env, stdio: "inherit" });
  return ran.error === undefined ? { code: ran.status } : { code: null, error: ran.error.message };
};

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
  login,
});
