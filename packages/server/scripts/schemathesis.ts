// Schemathesis against a server on a fresh state folder with a live session: every answer it provokes must match the
// committed OpenAPI document. The Schemathesis command comes as the arguments, for example
// `node scripts/schemathesis.ts pipx run --spec schemathesis==4.33.0 schemathesis`.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CSRF_HEADER } from "@cedarloom/contracts";
import { startServer } from "@cedarloom/server";
import { z } from "zod";

const [command = "schemathesis", ...prefix] = process.argv.slice(2);
const state = join(mkdtempSync(join(tmpdir(), "cedarloom-schemathesis-")), "state");
const server = await startServer({ state, log: (text) => process.stderr.write(text) });
const { origin, hash } = new URL(server.url);
const exchanged = await fetch(`${origin}/api/session`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ token: hash.slice("#t=".length) }),
});
const cookie = exchanged.headers.get("set-cookie")?.split(";")[0] ?? "";
const { csrf } = z.object({ csrf: z.string() }).parse(await exchanged.json());
const document = join(import.meta.dirname, "..", "openapi.json");
const args = [...prefix, "run", document, "--url", origin, "-H", `cookie: ${cookie}`, "-H", `${CSRF_HEADER}: ${csrf}`];
const child = spawn(command, args, { stdio: "inherit" });
process.exitCode = await new Promise<number>((resolve) => child.on("exit", (code) => resolve(code ?? 1)));
await server.close();
