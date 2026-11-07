import { startWorker, workers } from "@cedarloom/extension-orca";
import type { ExecParams, ExecResult, TargetContext } from "@cedarloom/extension-sdk";
import { expect, test } from "vitest";

// Orca 1.4.251's answers as the live test of 2026-11-07 got them, cut to the fields read, paths replaced.
const ok = (result: unknown): ExecResult => ({
  code: 0,
  stdout: JSON.stringify({ id: "1", ok: true, result }),
  stderr: "",
});
const WAITING = { satisfied: false, status: "running", blockedReason: "agent-trust-workspace" };

/**
 * A fake Orca: the worktree, made from /work/repo unless it is the main checkout, a new terminal per create, and the
 * agent's screen held at `blocked` until two keys arrive. `ran` keeps each command without its `--json`.
 */
const PROMPT = [" Security guide", " \u276f No, exit", "   Yes, I trust this folder", " Enter to confirm"];
const orca = ({ main = false, blocked = WAITING, screen = PROMPT } = {}) => {
  const ran: string[][] = [];
  let [terminals, keys] = [0, 0];
  const answers: Record<string, () => unknown> = {
    "worktree show": () => ({ worktree: { repoId: "r1", isMainWorktree: main } }),
    "repo show": () => ({ repo: { id: "r1", path: "/work/repo" } }),
    "terminal create": () => ({ terminal: { handle: `term_${(terminals += 1)}` } }),
    "terminal wait": () => ({ wait: keys >= 2 ? { satisfied: true, status: "running" } : blocked }),
    "terminal read": () => ({ terminal: { tail: screen } }),
    "terminal send": () => ({ send: { accepted: (keys += 1) > 0 } }),
    "orchestration worker-start": () => ({ dispatchId: "ctx_1", state: "ready", mode: "terminal" }),
    "orchestration worker-show": () => ({ state: "succeeded", stage: "settled", terminalState: "retained" }),
    "terminal close": () => ({ close: { handle: "term" } }),
  };
  const exec = async ({ args = [] }: ExecParams): Promise<ExecResult> => {
    ran.push(args.slice(0, -1));
    const answer = answers[`${args[0]} ${args[1]}`];
    if (answer === undefined) throw new Error(`no fake answer for ${args.join(" ")}`);
    return ok(answer());
  };
  return { exec, ran };
};
const on = (exec: TargetContext["exec"]): TargetContext => ({ locale: "en", exec });
const START = {
  worktree: "path:/work/repo-fix",
  line: ["/home/me/.local/bin/cswap", "run", "1", "--require-session", "--", "--append-system-prompt", "it's"],
  spec: "Fix it.",
  title: "fix",
  repository: "/work/repo",
};
const verbs = (ran: string[][]) => ran.map(([noun, verb]) => `${noun} ${verb}`);
const closed = (ran: string[][]) => ran.filter(([, verb]) => verb === "close").map(([, , , handle]) => handle);
const sent = (ran: string[][]) => ran.filter(([, verb]) => verb === "send").length;

test("a worker starts on the launch line in its worktree's terminal, its trust prompt answered, from a shell beside it", async () => {
  const fake = orca();
  expect([await startWorker(fake, START, "darwin"), fake.ran.filter(([, verb]) => verb !== "wait")]).toEqual([
    { dispatch: "ctx_1", handles: ["term_2", "term_1"] },
    [
      ["worktree", "show", "--worktree", "path:/work/repo-fix"],
      ["repo", "show", "--repo", "id:r1"],
      ["terminal", "create", "--worktree", "path:/work/repo-fix", "--title", "fix (CedarLoom)"],
      [
        "terminal",
        "create",
        "--worktree",
        "path:/work/repo-fix",
        "--title",
        "fix",
        "--command",
        "'/home/me/.local/bin/cswap' 'run' '1' '--require-session' '--' '--append-system-prompt' 'it'\\''s'",
      ],
      ["terminal", "read", "--terminal", "term_2"],
      ["terminal", "send", "--terminal", "term_2", "--text", "\u001b[B"],
      ["terminal", "send", "--terminal", "term_2", "--text", "\r"],
      [
        "orchestration",
        "worker-start",
        "--from",
        "term_1",
        "--terminal",
        "term_2",
        "--worktree",
        "path:/work/repo-fix",
        "--spec",
        "Fix it.",
        "--task-title",
        "fix",
      ],
    ],
  ]);
});

test("the trust prompt of a main checkout or another repository's worktree, another block or another screen, or Windows starts nothing and closes what it opened", async () => {
  const [main, elsewhere, blocked, unlike, windows] = [
    orca({ main: true }),
    orca(),
    orca({ blocked: { satisfied: false, status: "running", blockedReason: "agent-login" } }),
    orca({ screen: [" \u276f Yes, I trust this folder", "   No, exit"] }),
    orca(),
  ];
  const outcomes = await Promise.all([
    startWorker(main, START, "linux").catch(() => "failed"),
    startWorker(elsewhere, { ...START, repository: "/work/other/" }, "linux").catch(() => "failed"),
    startWorker(blocked, START, "linux").catch(() => "failed"),
    startWorker(unlike, START, "linux").catch(() => "failed"),
    startWorker(windows, START, "win32").catch(() => "failed"),
  ]);
  const fakes = [main, elsewhere, blocked, unlike];
  expect([
    outcomes,
    fakes.map(({ ran }) => closed(ran)),
    fakes.map(({ ran }) => sent(ran)),
    verbs(windows.ran),
  ]).toEqual([
    ["failed", "failed", "failed", "failed", "failed"],
    [
      ["term_2", "term_1"],
      ["term_2", "term_1"],
      ["term_2", "term_1"],
      ["term_2", "term_1"],
    ],
    [0, 0, 0, 0],
    [],
  ]);
});

test("a worker's state shows whether it settled, and its release closes the runner's terminals", async () => {
  const fake = orca();
  expect([
    await workers["worker/show"]?.({ runner: "claude", dispatch: "ctx_1" }, on(fake.exec)),
    await workers["worker/release"]?.({ runner: "claude", handles: ["term_2", "term_1"] }, on(fake.exec)),
    verbs(fake.ran),
  ]).toEqual([
    { state: "succeeded", settled: true },
    { released: true },
    ["orchestration worker-show", "terminal close", "terminal close"],
  ]);
});
