import { execFile } from "node:child_process";
import { once } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { type Launch, sandboxRuntime } from "@cedarloom/extension-host";
import { afterAll, expect, test } from "vitest";

const run = promisify(execFile);
const scratch = realpathSync(mkdtempSync(join(process.env["RUNNER_TEMP"] ?? tmpdir(), "cedarloom-sandbox-")));
const own = join(scratch, "own");
mkdirSync(own);
writeFileSync(join(own, "file"), "own");
writeFileSync(join(scratch, "outside"), "outside");
// The temp folder srt opens for writing in every sandbox, under a name of this run's own.
mkdirSync("/tmp/claude", { recursive: true });
const claude = join(realpathSync("/tmp/claude"), `cedarloom-${process.pid}`);
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(claude, { force: true });
});

const sandbox = sandboxRuntime();
const policy = { read: [own], write: [], network: "none" as const };
// A machine where no sandboxed process starts (the rootless dev container) skips; CI's runners do not.
const wrapped = async (launch: Launch, skip: (note: string) => void): Promise<Launch> => {
  const result = await sandbox.wrap(launch, policy).catch((error: unknown) => String(error));
  if (typeof result !== "object" && process.env["CI"] !== "true") skip(String(result));
  if (typeof result !== "object") throw new Error(String(result));
  return result;
};

// What a plain Node, without its permission flags, may do inside: only srt stands between it and the machine.
const attempts = (port: number) => `
const fs = require("node:fs");
const net = require("node:net");
const tried = (attempt) => { try { attempt(); return "allowed"; } catch { return "refused"; } };
const connects = (to) => new Promise((resolve) => {
  const socket = net.connect(to, () => { socket.destroy(); resolve("allowed"); });
  socket.on("error", () => resolve("refused"));
});
(async () => console.log(JSON.stringify({
  readOwn: tried(() => fs.readFileSync(${JSON.stringify(join(own, "file"))})),
  readOutside: tried(() => fs.readFileSync(${JSON.stringify(join(scratch, "outside"))})),
  write: tried(() => fs.writeFileSync(${JSON.stringify(claude)}, "x")),
  tcp: await connects({ host: "127.0.0.1", port: ${port} }),
  unix: await connects({ path: ${JSON.stringify(join(own, "socket"))} }),
})))();
`;

test.skipIf(process.platform === "win32")(
  "a plain node inside sandbox-runtime reads its policy's folder only, writes nowhere, and connects to nothing",
  async ({ skip }) => {
    const tcp = createServer((socket) => socket.destroy()).listen(0, "127.0.0.1");
    const unix = createServer((socket) => socket.destroy()).listen(join(own, "socket"));
    await Promise.all([once(tcp, "listening"), once(unix, "listening")]);
    try {
      const port = Number(Reflect.get(Object(tcp.address()), "port"));
      const launch = { command: process.execPath, args: ["-e", attempts(port)], cwd: own, env: {} };
      const inside = await wrapped(launch, skip);
      const { stdout } = await run(inside.command, inside.args, { cwd: own, env: inside.env, timeout: 30_000 });
      expect(JSON.parse(stdout)).toEqual({
        readOwn: "allowed",
        readOutside: "refused",
        write: "refused",
        tcp: "refused",
        unix: "refused",
      });
    } finally {
      tcp.close();
      unix.close();
    }
  },
  60_000,
);

test.skipIf(process.platform === "win32")(
  "a program that does not start inside sandbox-runtime fails the wrap with what it was refused",
  async ({ skip }) => {
    await wrapped({ command: process.execPath, args: [], cwd: own, env: {} }, skip);
    // A start that needs a file outside what the sandbox opens, as a Node installed outside its system list does.
    const program = join(own, "program");
    writeFileSync(program, `#!/bin/sh\nexec /bin/cat ${join(scratch, "outside")}\n`);
    chmodSync(program, 0o755);
    await expect(sandbox.wrap({ command: program, args: [], cwd: own, env: {} }, policy)).rejects.toThrow(
      join(scratch, "outside"),
    );
  },
  60_000,
);
