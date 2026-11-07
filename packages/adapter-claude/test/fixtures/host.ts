// A host of the adapter: starts the fake CLI with a command in a group of its own, as Claude Code's Bash tool runs one,
// and one in the fake's own group, prints the three process IDs as one JSON line, and runs until it is killed.
import { join } from "node:path";
import { claudeRuntime, FRESH_INSTALL_PHASES } from "@cedarloom/adapter-claude";
import { z } from "zod";

const fixtures = import.meta.dirname;
// A short grace, so a test sees the group killed soon after the host.
const runtime = claudeRuntime([process.execPath, join(fixtures, "fake-claude.ts")], 200);
const session = runtime.start({
  ...FRESH_INSTALL_PHASES.implement,
  home: fixtures,
  cwd: fixtures,
  prompt: "Do the task.",
  env: { FAKE_HANG: "1", FAKE_CHILD: "1", FAKE_GROUPED: "1" },
  tmpDir: join(fixtures, "tmp"),
  resultFile: join(fixtures, "out", "result.json"),
  denyRead: [],
  allowedDomains: [],
  allow: [],
  verifiedVersions: [],
  pluginDirs: [],
});
const Line = z.object({ type: z.string(), pid: z.int() });
const pids: Record<string, number> = {};
for await (const event of session.events) {
  const line = Line.safeParse(event.type === "other" ? event.raw : null).data;
  if (line !== undefined) pids[line.type === "fake" ? "cli" : line.type] = line.pid;
  if (line?.type === "grouped") process.stdout.write(`${JSON.stringify(pids)}\n`);
}
