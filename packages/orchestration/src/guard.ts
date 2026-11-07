import type { GuardPolicy } from "@cedarloom/contracts";
import { type Command, readShell, type Script, type Word } from "./shell.ts";

/** Why the guard refuses a call. */
export type Rule = "unreadable" | "environment" | "forbidden";

export interface Denial {
  readonly rule: Rule;
  readonly detail: string;
}

interface Context {
  readonly policy: GuardPolicy;
  readonly text: string;
  readonly depth: number;
}

const deny = (rule: Rule, detail: string): Denial => ({ rule, detail });
const unreadable = (detail: string): Denial => deny("unreadable", detail);

// A program the guard checks, named anywhere in a text, in any case, after a path or as git-<command>.
const GUARDED = /(?:^|[^\w.-])(?:gh|git|curl)\b/i;
// Variables that choose the token, gh's or git's configuration, the home both read it from, or git's repository (A13).
const PROTECTED_NAMES =
  "GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|GITHUB_ENTERPRISE_TOKEN|GH_CONFIG_DIR|GH_HOST|GIT_CONFIG\\w*|GIT_DIR|" +
  "GIT_WORK_TREE|GIT_SSH|GIT_SSH_COMMAND|GIT_ASKPASS|SSH_ASKPASS|HOME|XDG_CONFIG_HOME";
const PROTECTED = new RegExp(`^(?:${PROTECTED_NAMES})$`);
const MENTIONED = new RegExp(`(?:^|\\W)(?:${PROTECTED_NAMES})(?:\\W|$)`);
const ASSIGNMENT = /^([A-Za-z_]\w*)(?:\[[^\]]*\])?\+?=/;
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish"]);
// A shell's options that take the next word as their value.
const SHELL_VALUED = new Set(["-o", "+o", "-O", "+O", "--rcfile", "--init-file"]);
// Words that run the command after them, and the options of theirs that take a value.
const WRAPPERS = new Map<string, readonly string[]>([
  ["command", []],
  ["builtin", []],
  ["exec", ["-a"]],
  ["nohup", []],
  ["time", []],
  ["nice", ["-n"]],
  ["timeout", ["-s", "-k", "--signal", "--kill-after"]],
  ["stdbuf", ["-i", "-o", "-e"]],
  ["setsid", []],
  ["ionice", ["-c", "-n", "-p"]],
  ["caffeinate", ["-t", "-w"]],
  ["watch", ["-n", "--interval"]],
  ["env", ["-u", "--unset", "-C", "--chdir"]],
  ["xargs", ["-I", "-n", "-L", "-P", "-d", "-E", "-s", "-a", "--max-args", "--max-procs", "--delimiter"]],
]);
const RESERVED = new Set(["if", "then", "else", "elif", "fi", "do", "done", "while", "until", "!", "{", "}"]);
const EXPORTS = new Set(["export", "declare", "typeset", "readonly", "local", "unset", "setenv"]);
// Builtins that set a variable named by an argument.
const SETTERS = new Set([...EXPORTS, "read", "printf", "mapfile", "readarray"]);
const MAX_DEPTH = 5;

const EMPTY: Word = { text: "", start: "" };
// A program by the name it runs under: its file name, in lower case (macOS and Windows match names so), without .exe.
const programOf = (word: string): string =>
  word
    .slice(word.lastIndexOf("/") + 1)
    .toLowerCase()
    .replace(/\.exe$/, "");
const literal = (words: readonly Word[]): string[] | null =>
  words.every((word) => word.text !== null) ? words.map((word) => word.text ?? "") : null;

/** Whether the guard refuses the shell command `text`, and why; null to let it run. */
export const guardCommand = (text: string, policy: GuardPolicy): Denial | null =>
  checkScript(readShell(text), { policy, text, depth: 0 });

const checkScript = (script: Script, context: Context): Denial | null => {
  if (script.skipped) return unreadable("the command holds text the guard cannot split, such as an unclosed quote");
  if (script.unmodeled && GUARDED.test(context.text)) {
    return unreadable("the command runs gh, git or curl in a loop, case or function, which the guard does not follow");
  }
  for (const command of script.commands) {
    const denial = checkCommand(command, context);
    if (denial !== null) return denial;
  }
  return null;
};

// A script the guard reads from a word, as `sh -c`, `eval` or `env -S` run it.
const nested = (text: string, context: Context): Denial | null =>
  context.depth >= MAX_DEPTH
    ? unreadable("the command nests shells too deep")
    : checkScript(readShell(text), { ...context, text, depth: context.depth + 1 });

interface Unwrapped {
  words: Word[];
  prefix: Word[];
  // xargs adds words it reads; env -i or exec -c clears the environment; env -S runs a word as a command line.
  appended: boolean;
  cleared: boolean;
  split: Word | null;
}

// The command's own words: assignments, reserved words and wrappers skipped, with the words before them (`prefix`).
const unwrap = (words: readonly Word[]): Unwrapped => {
  const found: Unwrapped = { words: [], prefix: [], appended: false, cleared: false, split: null };
  let i = 0;
  while (i < words.length) {
    const { text, start } = words[i] ?? EMPTY;
    const name = programOf(text ?? "");
    const valued = WRAPPERS.get(name);
    if (ASSIGNMENT.test(start) || RESERVED.has(text ?? "")) i += 1;
    else if (valued === undefined) break;
    else i = wrapper(name, words, i + 1, { valued, found });
  }
  return { ...found, words: words.slice(i), prefix: words.slice(0, i) };
};

// A wrapper's options from `from` on, noted in `found`; the index of the word after them.
const wrapper = (
  name: string,
  words: readonly Word[],
  from: number,
  { valued, found }: { valued: readonly string[]; found: Unwrapped },
): number => {
  let i = from;
  for (; (words[i]?.start ?? "").startsWith("-"); i += 1) {
    const option = words[i]?.start ?? "";
    if (noteOption(name, option, words[i + 1], found) || valued.includes(option)) i += 1;
  }
  found.appended ||= name === "xargs";
  // timeout's duration comes before its command.
  return i + (name === "timeout" ? 1 : 0);
};

// What an option of env or exec does to the command, noted in `found`; true when it takes the next word.
const noteOption = (name: string, option: string, next: Word | undefined, found: Unwrapped): boolean => {
  if (name === "exec") found.cleared ||= option === "-c";
  if (name !== "env") return false;
  found.cleared ||= /^(?:-i|--ignore-environment|-)$/.test(option);
  if (!/^(?:-S|--split-string)/.test(option)) return false;
  found.split = splitString(option, next);
  return /^(?:-S|--split-string)$/.test(option);
};

// The command line of env -S: attached to the option, or the next word.
const splitString = (option: string, next: Word | undefined): Word | null => {
  const attached = /^(?:-S|--split-string=)(.+)$/.exec(option)?.[1];
  return attached === undefined ? (next ?? null) : { text: attached, start: attached };
};

// The variable a word before the command changes: NAME=value sets it, env -u NAME (or -uNAME, --unset=NAME) unsets it.
const variableOf = (word: Word, next: Word | undefined): string => {
  if (/^(?:-u|--unset)$/.test(word.start)) return next?.start ?? "";
  return ASSIGNMENT.exec(word.start)?.[1] ?? /^(?:-u|--unset=)(.+)$/.exec(word.start)?.[1] ?? "";
};

const checkPrefix = ({ prefix, cleared, split }: Unwrapped, context: Context): Denial | null => {
  const changed = prefix.map((word, index) => variableOf(word, prefix[index + 1])).find((name) => PROTECTED.test(name));
  if (changed !== undefined) return deny("environment", `it changes ${changed}`);
  if (cleared) return deny("environment", "it clears the environment, the token with it");
  if (split === null) return null;
  return split.text === null ? unreadable("env -S runs words the guard cannot read") : nested(split.text, context);
};

// Programs that run their arguments, which xargs would hand words the guard cannot read.
const runsArguments = (name: string): boolean =>
  GUARDED.test(` ${name} `) ||
  SHELLS.has(name) ||
  WRAPPERS.has(name) ||
  FORBIDDEN.has(name) ||
  /^(?:eval|source|\.|find)$/.test(name);

const XARGS = unreadable("xargs adds words the guard cannot read to a program that runs them");

const checkCommand = (command: Command, context: Context): Denial | null => {
  const unwrapped = unwrap(command.words);
  const denial = checkPrefix(unwrapped, context);
  if (denial !== null || unwrapped.split !== null) return denial;
  const [first, ...args] = unwrapped.words;
  if (first === undefined) return unwrapped.appended ? XARGS : null;
  if (first.text === null) return unreadable("it runs a command whose name the guard cannot read");
  const name = programOf(first.text);
  if (unwrapped.appended && runsArguments(name)) return XARGS;
  return checkProgram(name, args, command, context);
};

const checkProgram = (name: string, args: Word[], command: Command, context: Context): Denial | null => {
  if (SETTERS.has(name)) return checkSetter(name, args);
  if (SHELLS.has(name) || name === "source" || name === ".") return checkShell(name, args, command, context);
  return checkRunner(name, args, context);
};

// find, eval and alias run words as commands; any other program is checked against the forbidden ones.
const checkRunner = (name: string, args: Word[], context: Context): Denial | null => {
  if (name === "find") return checkFind(args, context);
  // An alias runs where a later line names it.
  if (name === "alias") return GUARDED.test(context.text) ? unreadable("an alias names gh, git or curl") : null;
  if (name !== "eval") return forbiddenProgram(name, args);
  const text = literal(args[0]?.text === "--" ? args.slice(1) : args);
  return text === null ? unreadable("eval runs words the guard cannot read") : nested(text.join(" "), context);
};

// Programs the project rules forbid, with the argument that makes them so: an apply, or any for a sudo-like.
const FORBIDDEN = new Map([
  ["sudo", null],
  ["doas", null],
  ["su", null],
  ["pkexec", null],
  ["run0", null],
  ["terraform", "apply"],
  ["kubectl", "apply"],
  ["helm", "upgrade"],
]);

const forbiddenProgram = (name: string, args: readonly Word[]): Denial | null => {
  const verb = FORBIDDEN.get(name);
  if (verb === undefined) return null;
  if (verb === null) return deny("forbidden", name);
  return args.some(({ text }) => text === verb) ? deny("forbidden", `${name} ${verb}`) : null;
};

// export, read, printf -v and the like: a word naming a protected variable refuses, as does a variable export or
// declare name the guard cannot read.
const checkSetter = (name: string, args: readonly Word[]): Denial | null => {
  for (const word of args) {
    if (MENTIONED.test(word.start)) return deny("environment", `${name} names a protected variable`);
    if (EXPORTS.has(name) && word.text === null && !word.start.includes("=")) {
      return unreadable(`${name} names a variable the guard cannot read`);
    }
  }
  return null;
};

// What a shell runs: its -c script, a file, its standard input, or null for a word the guard cannot read.
type Source = { script: string } | "file" | "stdin" | null;

const textAt = (words: readonly Word[], i: number): string | null => words[i]?.text ?? null;

// The script of a shell: after its options, the -c script or a file; stdin with -s or without either.
const shellScript = (args: readonly Word[]): Source => {
  let command = false;
  for (let i = 0; i < args.length; i += 1) {
    const text = textAt(args, i);
    const option = text === null ? null : shellOption(text);
    if (option === null && text !== "--") return scriptOf(text, command);
    if (option === "stdin") return "stdin";
    command ||= option === "command";
    if (option === "value") i += 1;
  }
  return command ? null : "stdin";
};

// What a shell option does: takes the next word, reads the script from stdin (-s), makes the next word the script
// (-c, --command), or nothing; null for a word that is no option.
const shellOption = (text: string): "value" | "stdin" | "command" | "flag" | null => {
  if (SHELL_VALUED.has(text)) return "value";
  if (text === "-s") return "stdin";
  if (!/^(?:[-+][A-Za-z]+|--[\w-]+)$/.test(text)) return null;
  return /^(?:-[A-Za-z]*c|--command$)/.test(text) ? "command" : "flag";
};

const scriptOf = (text: string | null, command: boolean): Source => {
  if (text === null) return null;
  if (text.startsWith("--command=")) return { script: text.slice("--command=".length) };
  if (command) return { script: text };
  return text === "-" || text === "/dev/stdin" || text.startsWith("/dev/fd/") ? "stdin" : "file";
};

// A shell runs its -c script or the heredoc or here-string fed to it; a script file is beyond the guard, and one from a
// pipe or a word it cannot read refuses.
const checkShell = (name: string, args: readonly Word[], command: Command, context: Context): Denial | null => {
  const script = name === "source" || name === "." ? scriptOf(textAt(args, 0), false) : shellScript(args);
  if (script === "file") return null;
  if (script === null) return unreadable(`${name} runs a script the guard cannot read`);
  if (script !== "stdin") return nested(script.script, context);
  const stdin = literal(command.stdin);
  return stdin === null || stdin.length === 0
    ? unreadable(`${name} reads its script from a pipe or a file the guard cannot read`)
    : nested(stdin.join("\n"), context);
};

// The commands find runs: the words after each -exec, -execdir, -ok or -okdir up to `;` or `+`.
const execSegments = (args: readonly Word[]): Word[][] => {
  const segments: Word[][] = [];
  let current: Word[] | null = null;
  for (const word of args) {
    if (current === null) current = /^-(?:exec|execdir|ok|okdir)$/.test(word.text ?? "") ? [] : null;
    else if (word.text === ";" || word.text === "+") {
      segments.push(current);
      current = null;
    } else current.push(word);
  }
  return current === null ? segments : [...segments, current];
};

const checkFind = (args: readonly Word[], context: Context): Denial | null =>
  execSegments(args)
    .map((words) => checkCommand({ words, stdin: [] }, context))
    .find((denial) => denial !== null) ?? null;
