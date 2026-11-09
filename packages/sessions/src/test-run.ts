import { parse } from "shell-quote";

const MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const split = (list: string[]): string[][] => list.map((item) => item.split(" "));
const TOOLS = split(["vitest", "jest", "pytest", "playwright test", "node --test", "go test", "cargo test"]);
const RUNNERS = split(["npx", "bunx", "yarn", "pnpm exec", "pnpm", "uv run", "python -m", "python3 -m"]);
const SEPARATORS = new Set([";", "&&", "||", "|", "|&", "&", ";;", "(", ")"]);
const starts = (words: string[], head: string[]): boolean => head.every((word, at) => words[at] === word);

/** How a test run's result shows: the command's exit code is the run's, or only the run's summary in the output is. */
export type TestRun = "exit" | "output" | null;

// A package manager's test script, after its flags and their values or after `run`: `pnpm --filter ui run test`.
const runsScript = (args: string[]): boolean => {
  const at = args.findIndex((arg) => /^test(?::\S+)?$/.test(arg));
  const before = args.slice(0, at);
  return at >= 0 && before.every((arg, i) => arg === "run" || arg.startsWith("-") || before[i - 1]?.startsWith("-"));
};

const runsSuite = (words: string[]): boolean => {
  if (MANAGERS.has(words[0] ?? "") && runsScript(words.slice(1))) return true;
  const runner = RUNNERS.find((head) => starts(words, head))?.length ?? 0;
  return TOOLS.some((tool) => starts(words.slice(runner), tool));
};

/** A test run in one command's words: a runner, a package manager's test script, or a shell's `-c` script with one. */
export const testRunIn = (words: string[]): TestRun => {
  const own = words.slice(words.findIndex((word) => !/^\w+=/.test(word)));
  const shell = own.findIndex((word) => word === "sh" || word === "bash");
  if (shell >= 0 && /^-[a-z]*c$/.test(own[shell + 1] ?? "")) return testRunOf(own[shell + 2] ?? "");
  return runsSuite(own) ? "exit" : null;
};

const lineCommands = (line: string): string[][] => {
  const commands: string[][] = [[]];
  for (const entry of parse(line, (name) => `$${name}`)) {
    if (typeof entry === "string") commands.at(-1)?.push(entry);
    else if ("op" in entry && SEPARATORS.has(entry.op)) commands.push([]);
    // A job sent to the background tells nothing of its result.
    if (typeof entry === "object" && "op" in entry && entry.op === "&") commands.splice(-2, 1);
  }
  return commands;
};

// A heredoc's body is text, not commands: `git commit -F - <<'EOF'` with `npm test passes` in it; its line stays.
const HEREDOC = /<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?^\s*\2\s*$/gm;

// The simple commands of a script, line by line; null for one the tokenizer refuses (a ${name%%...} expansion).
const commandsOf = (script: string): string[][] | null => {
  try {
    return script
      .replaceAll(HEREDOC, "$3")
      .split("\n")
      .flatMap(lineCommands)
      .filter((words) => words.length > 0);
  } catch {
    return null;
  }
};

/** A test run in a shell script: its exit code counts when the run is the script's last command, else its summary does. */
export const testRunOf = (script: string): TestRun => {
  // Tokenizing is the slow part of reading a log: most commands name no runner at all.
  if (!/test|jest/.test(script)) return null;
  const runs = (commandsOf(script) ?? []).map(testRunIn);
  if (runs.at(-1) === "exit") return "exit";
  return runs.some((run) => run !== null) ? "output" : null;
};

// pytest ends with the error count (`31 passed, 2 errors in 1.2s`), vitest prints `Errors  1 error` beside its tests.
const FAILED =
  /\b[1-9]\d* (?:failed|failing)\b|^\s*FAIL\b|\btest result: FAILED\b|^(?:ℹ|#) fail [1-9]|\b[1-9]\d* errors? in \d+(?:\.\d+)?s\b|^\s*(?:Type )?Errors\s+[1-9]/m;
const PASSED = /\b[1-9]\d* (?:passed|passing)\b|^ok\s|\btest result: ok\b|^(?:ℹ|#) pass [1-9]/m;

/** A test run's result from the runner's summary line: a count of failures fails it, a count of passes alone passes it. */
export const outcomeOf = (output: string): "pass" | "fail" | null => {
  // Without the color codes, which would join a count to the word before it.
  const text = output.replaceAll(/\p{Cc}\[[\d;]*m/gu, "");
  if (FAILED.test(text)) return "fail";
  return PASSED.test(text) ? "pass" : null;
};
