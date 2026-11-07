#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { claudeAuthStatus, claudeLogin, claudeRuntime } from "@cedarloom/adapter-claude";
import { programPath } from "@cedarloom/use-cases";
import { main } from "./main.ts";

// Only a long-running command asks to be stopped, so Ctrl+C ends every other one as usual.
const untilStopped = (): Promise<void> =>
  new Promise((resolve) => {
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => resolve());
  });

// Claude Code by its file, never by its bare name; off PATH, where its installer puts it
// (https://code.claude.com/docs/en/troubleshoot-install), so a missing one fails to start.
const native = join(homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude");
const claude = [programPath("claude", process.env) ?? native] as const;

process.exitCode = await main(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  env: process.env,
  untilStopped,
  login: claudeLogin(claude),
  authStatus: claudeAuthStatus(claude),
  agent: claudeRuntime(claude),
});
