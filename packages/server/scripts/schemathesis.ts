// Schemathesis against a server on a fresh state folder with one applied run and a live session: every answer it
// provokes must match the committed OpenAPI document. The Schemathesis command comes as the arguments, for example
// `node scripts/schemathesis.ts .venv/bin/schemathesis` (CI installs it from .github/schemathesis/requirements.txt).
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CSRF_HEADER } from "@cedarloom/contracts";
import { startServer } from "@cedarloom/server";
import { applyPlan } from "@cedarloom/services";
import { z } from "zod";

const [command = "schemathesis", ...prefix] = process.argv.slice(2);
const root = mkdtempSync(join(tmpdir(), "cedarloom-schemathesis-"));
const state = join(root, "state");
// One applied run, whose id every {runId} parameter gets, so the run operations answer from a run and not only 404.
const seed = { kind: "write" as const, path: join(root, "seed.md"), before: null, content: "seed\n" };
const run = applyPlan(state, { schemaVersion: 1, operations: [seed] }, { yes: true });
if (!run.ok || run.value.runId === null) throw new Error("the seed run did not apply");
const config = join(root, "schemathesis.toml");
writeFileSync(config, `[parameters]\n"path.runId" = "${run.value.runId}"\n`);

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
const session = ["-H", `cookie: ${cookie}`, "-H", `${CSRF_HEADER}: ${csrf}`];
// The event stream never ends, so Schemathesis would wait on it until its timeout; the server tests cover it.
const only = ["--exclude-path", "/api/events"];
const child = spawn(
  command,
  [...prefix, "--config-file", config, "run", document, "--url", origin, ...only, ...session],
  {
    stdio: "inherit",
  },
);
process.exitCode = await new Promise<number>((resolve) => child.on("exit", (code) => resolve(code ?? 1)));
await server.close();
