import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession } from "@cedarloom/contracts";
import { afterAll, expect, test } from "vitest";
import { readSessions } from "@cedarloom/sessions";

// Recorded with Claude Code 2.1.316 (`claude -p`, one test run each), then scrubbed: every string but ids, types, tool
// names, the test command and its output became "[scrubbed]", and the folders /work/shop and /work/lab.
const fixtures = join(import.meta.dirname, "fixtures");
const SHOP = "f828b5b9-c62e-4a8a-87f5-baef7bb31780";
const LAB = "ea9a8a8f-8077-4156-90ab-85038e621848";

// GitHub's Windows runners keep os.tmpdir() on the slow system drive.
const root = mkdtempSync(join(process.env["RUNNER_TEMP"] ?? tmpdir(), "cedarloom-sessions-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let made = 0;
// A Claude Code home, and a repository whose linked worktree the shop session ran in, laid out as git leaves them.
const machine = () => {
  const at = join(root, String(made++));
  const repository = join(at, "shop");
  const own = join(repository, ".git", "worktrees", "shop-feature");
  const worktree = join(at, "worktrees", "shop-feature");
  mkdirSync(own, { recursive: true });
  writeFileSync(join(own, "commondir"), "../..\n");
  mkdirSync(worktree, { recursive: true });
  writeFileSync(join(worktree, ".git"), `gitdir: ${own}\n`);
  const home = join(at, "claude");
  // The fixture as the Claude Code home holds it, the shop session's folder moved into the worktree; `lines` cuts it short.
  const put = (id: string, folder: string, lines?: number): string => {
    mkdirSync(join(home, "projects", folder), { recursive: true });
    const text = readFileSync(join(fixtures, "claude", `${id}.jsonl`), "utf8");
    const moved = text.replaceAll('"cwd":"/work/shop"', `"cwd":${JSON.stringify(worktree)}`);
    const file = join(home, "projects", folder, `${id}.jsonl`);
    writeFileSync(file, lines === undefined ? moved : `${moved.split("\n").slice(0, lines).join("\n")}\n`);
    return file;
  };
  return { repository, worktree, put, logs: { claude: home, codex: join(at, "codex"), cache: join(at, "cache.json") } };
};

const shop = {
  agent: "claude-code",
  id: SHOP,
  title: null,
  start: "2026-11-09T08:44:19.864Z",
  end: "2026-11-09T08:44:23.987Z",
  busyMs: 4075,
  tokens: 41248,
  costUSD: 0.0401998,
  costEstimated: false,
  unpriced: [],
  // Its one run, `npm test 2>&1 | tail -30`, exits with tail's code: its summary counts.
  tests: "pass",
} as const satisfies Omit<AgentSession, "project">;

test("Claude Code sessions: cost, agent time and tokens from the last cost-state line, the last test run, the repository", async () => {
  const { put, repository, logs } = machine();
  const file = put(SHOP, "-work-shop");
  // A copy Claude Code set aside is no session of its own.
  copyFileSync(file, file.replace(/\.jsonl$/, ".orphaned-1794213859000-ab12.jsonl"));
  put(LAB, "-work-lab");
  expect(await readSessions({ ...logs, cache: null })).toEqual([
    {
      ...shop,
      id: LAB,
      project: "/work/lab",
      start: "2026-11-09T08:44:25.099Z",
      end: "2026-11-09T08:44:27.881Z",
      busyMs: 2736,
      tokens: 41169,
      costUSD: 0.0384998,
      tests: "fail",
    },
    { ...shop, project: repository },
  ]);
});

test("the cache holds only logs that are there, reads a grown one again and keeps its project once the worktree is gone", async () => {
  const { put, repository, worktree, logs } = machine();
  // Still running: no cost-state line yet, so no cost or agent time, and each message's tokens once.
  const file = put(SHOP, "-work-shop", 29);
  expect(await readSessions(logs)).toEqual([{ ...shop, project: repository, busyMs: null, costUSD: null }]);
  rmSync(join(worktree, ".git"));
  put(SHOP, "-work-shop");
  expect(await readSessions(logs)).toEqual([{ ...shop, project: repository }]);
  rmSync(file);
  expect(await readSessions(logs)).toEqual([]);
});

// One recorded session with one edit in its JSON, read alone: its test result.
const testsAfter = async (
  id: string,
  folder: string,
  from: string,
  to: string,
): Promise<AgentSession["tests"] | undefined> => {
  const { put, logs } = machine();
  const file = put(id, folder);
  writeFileSync(file, readFileSync(file, "utf8").replace(from, to));
  return (await readSessions({ ...logs, cache: null }))[0]?.tests;
};

test.each([
  ['pnpm --filter "...[origin/main]" run test', "fail"],
  ['git commit -m "fix; npm test"', null],
  ["npm test &", null],
  ["git commit -F - <<'EOF'\nnpm test passes now\nEOF", null],
  ["cat <<'EOF' > notes.md && npm test\nnotes\nEOF", "fail"],
])(
  "a failed command's exit code is the test result only when the command ends with a test run: %s",
  async (command, tests) => {
    expect(await testsAfter(LAB, "-work-lab", '"command":"npm test"', `"command":${JSON.stringify(command)}`)).toBe(
      tests,
    );
  },
);

// The shop session's piped run, `npm test 2>&1 | tail -30`, which exited 0, with another summary line in its output.
test.each([
  ["Tests  1 failed | 31 passed (32)", "fail"],
  ["Tests  1 passed (1)\n     Errors  1 error", "fail"],
  ["31 passed, 2 errors in 1.2s", "fail"],
  ["Found 3 errors in 2 files.\n 2 passed", "pass"],
])("a piped run's result is its summary line, whatever the pipe's exit code: %s", async (summary, tests) => {
  const output = JSON.stringify(`\n\n${summary}`).slice(1, -1);
  expect(await testsAfter(SHOP, "-work-shop", String.raw`\n\n2 passed`, output)).toBe(tests);
});

// Built from the rollout format of openai/codex at 8703d32b: no Codex rollout was recorded yet.
test("Codex sessions: a subagent's tokens and cost on its root row at list prices, another provider's unpriced, the last test run", async () => {
  const codex = { agent: "codex", project: "/work/shop", title: null } as const;
  expect(await readSessions({ claude: join(root, "none"), codex: join(fixtures, "codex"), cache: null })).toEqual([
    {
      ...codex,
      id: "019a3c11-7a4f-7d55-b032-1e8f5c2d9e03",
      start: "2026-11-02T14:00:00.000Z",
      end: "2026-11-02T14:00:31.000Z",
      busyMs: 30000,
      tokens: 4000,
      costUSD: null,
      costEstimated: false,
      unpriced: ["gpt-oss:20b"],
      tests: null,
    },
    {
      // A fork of the root: only what it added counts, not the history and totals it copied (with a failed test run).
      ...codex,
      id: "019a3d02-4e6f-7a18-b2c3-5d4e6f708a04",
      start: "2026-11-02T10:00:00.000Z",
      end: "2026-11-02T10:00:07.000Z",
      busyMs: 2000,
      tokens: 1100,
      costUSD: expect.closeTo(0.0062, 9),
      costEstimated: true,
      unpriced: [],
      tests: null,
    },
    {
      ...codex,
      id: "019a3b7e-5c1d-7e42-9a10-3f2c8d4e6a01",
      start: "2026-11-02T09:00:00.000Z",
      end: "2026-11-02T09:01:30.000Z",
      // Its own 90 s of turns and its subagent's 5 s; the subagent names its parent in `source` only.
      busyMs: 95000,
      tokens: 293800,
      // gpt-5.5 at 0.038 (short context) and 1.099 (long), its gpt-5.4-mini subagent at 0.002175.
      costUSD: expect.closeTo(1.139175, 9),
      costEstimated: true,
      unpriced: [],
      // A piped run counts by its summary line, not its exit code; a quoted `npm test` and a declined one are no runs.
      tests: "pass",
    },
  ]);
});
