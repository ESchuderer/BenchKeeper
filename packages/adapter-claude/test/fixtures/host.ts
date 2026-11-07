// A host of the adapter: starts the fake CLI with a command in its process group, prints both process IDs as one JSON
// line, and runs until it is killed.
import { join } from "node:path";
import { claudeRuntime, FRESH_INSTALL_PHASES } from "@cedarloom/adapter-claude";
import { z } from "zod";

const fixtures = import.meta.dirname;
const runtime = claudeRuntime([process.execPath, join(fixtures, "fake-claude.ts")]);
const session = runtime.start({
  ...FRESH_INSTALL_PHASES.implement,
  home: fixtures,
  cwd: fixtures,
  prompt: "Do the task.",
  env: { FAKE_HANG: "1", FAKE_GROUPED: "1" },
  tmpDir: join(fixtures, "tmp"),
  resultFile: join(fixtures, "out", "result.json"),
  denyRead: [],
  allowedDomains: [],
  allow: [],
  verifiedVersions: [],
  pluginDirs: [],
});
const Line = z.object({ type: z.string(), pid: z.int() });
let cli: number | undefined;
for await (const event of session.events) {
  const line = Line.safeParse(event.type === "other" ? event.raw : null).data;
  if (line?.type === "fake") cli = line.pid;
  if (line?.type === "grouped") process.stdout.write(`${JSON.stringify({ cli, command: line.pid })}\n`);
}
