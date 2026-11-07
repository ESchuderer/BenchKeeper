import type { GuardPolicy } from "@cedarloom/contracts";
import { type Command, readShell, type Script, type Word } from "./shell.ts";

/** Why the guard refuses a call. */
export type Rule = "unreadable" | "environment" | "git-config" | "forbidden" | "outside-profiles" | "memory-main";

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

// A program the guard checks, named anywhere in a text as a word of its own.
const GUARDED = /(?:^|[^\w./-])(?:gh|git|curl)(?:[^\w.-]|$)/;
// Variables that choose the token, gh's or git's configuration, or the repository git works on (A13).
const PROTECTED =
  /^(?:GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|GITHUB_ENTERPRISE_TOKEN|GH_CONFIG_DIR|GH_HOST|GIT_CONFIG\w*|GIT_DIR|GIT_WORK_TREE|GIT_SSH|GIT_SSH_COMMAND|GIT_ASKPASS|SSH_ASKPASS)$/;
const ASSIGNMENT = /^([A-Za-z_]\w*)=/;
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish"]);
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
  ["env", ["-u", "--unset", "-C", "--chdir", "-S", "--split-string"]],
  ["xargs", ["-I", "-n", "-L", "-P", "-d", "-E", "-s", "-a", "--max-args", "--max-procs", "--delimiter"]],
]);
const RESERVED = new Set(["if", "then", "else", "elif", "fi", "do", "done", "while", "until", "!", "{", "}"]);
const EXPORTS = new Set(["export", "declare", "typeset", "readonly", "local", "unset", "setenv"]);
const MAX_DEPTH = 5;

const base = (word: string): string => word.slice(word.lastIndexOf("/") + 1);
const EMPTY: Word = { text: "", start: "" };
const literal = (words: readonly Word[]): string[] | null =>
  words.every((word) => word.text !== null) ? words.map((word) => word.text ?? "") : null;

/** Whether the guard refuses the shell command `text`, and why; null to let it run. */
export const guardCommand = (text: string, policy: GuardPolicy): Denial | null =>
  checkScript(readShell(text), { policy, text, depth: 0 });

const checkScript = (script: Script, context: Context): Denial | null => {
  if (script.unread && GUARDED.test(context.text)) {
    return unreadable(
      "the command holds shell syntax the guard does not read (a loop, case, function or an unclosed quote)",
    );
  }
  for (const command of script.commands) {
    const denial = checkCommand(command, context);
    if (denial !== null) return denial;
  }
  return null;
};

// A script the guard reads from a word, as `sh -c` or `eval` run it.
const nested = (text: string, context: Context): Denial | null =>
  context.depth >= MAX_DEPTH
    ? unreadable("the command nests shells too deep")
    : checkScript(readShell(text), { ...context, text, depth: context.depth + 1 });

// The command's own words: assignments, reserved words and wrappers skipped, with the words before them (`prefix`).
// `appended`: xargs adds words it reads.
const unwrap = (words: readonly Word[]): { words: Word[]; prefix: Word[]; appended: boolean } => {
  let appended = false;
  let i = 0;
  while (i < words.length) {
    const { text, start } = words[i] ?? EMPTY;
    const name = base(text ?? "");
    const valued = WRAPPERS.get(name);
    if (ASSIGNMENT.test(start) || RESERVED.has(name)) i += 1;
    else if (valued === undefined) break;
    else {
      appended ||= name === "xargs";
      // timeout's duration comes before its command.
      i = skipOptions(words, i + 1, valued) + (name === "timeout" ? 1 : 0);
    }
  }
  return { words: words.slice(i), prefix: words.slice(0, i), appended };
};

// The index of the first word from `from` on that is no option with its value.
const skipOptions = (words: readonly Word[], from: number, valued: readonly string[]): number => {
  let i = from;
  while (i < words.length && (words[i]?.start ?? "").startsWith("-")) {
    i += valued.includes(words[i]?.start ?? "") ? 2 : 1;
  }
  return i;
};

// The variable a word before the command changes: NAME=value sets it, env -u NAME and --unset=NAME unset it.
const variableOf = (word: Word, next: Word | undefined): string => {
  if (/^(?:-u|--unset)$/.test(word.start)) return next?.start ?? "";
  return ASSIGNMENT.exec(word.start)?.[1] ?? /^--unset=(.*)$/.exec(word.start)?.[1] ?? "";
};

const changedVariable = (prefix: readonly Word[]): string | undefined =>
  prefix.map((word, index) => variableOf(word, prefix[index + 1])).find((name) => PROTECTED.test(name));

const checkCommand = (command: Command, context: Context): Denial | null => {
  const { words, prefix, appended } = unwrap(command.words);
  const changed = changedVariable(prefix);
  if (changed !== undefined) return deny("environment", `it changes ${changed}`);
  const [first, ...args] = words;
  if (first === undefined) return null;
  if (first.text === null) return unreadable("it runs a command whose name the guard cannot read");
  const name = base(first.text);
  if (appended && GUARDED.test(` ${name} `))
    return unreadable(`xargs adds words to ${name} that the guard cannot read`);
  return checkProgram(name, args, command, context);
};

const checkProgram = (name: string, args: Word[], command: Command, context: Context): Denial | null => {
  if (name === "git") return checkGit(args);
  if (EXPORTS.has(name)) return checkExports(name, args);
  if (SHELLS.has(name)) return checkShell(name, args, command, context);
  if (name !== "eval") return forbiddenProgram(name, args);
  const text = literal(args);
  return text === null ? unreadable("eval runs words the guard cannot read") : nested(text.join(" "), context);
};

// Programs the project rules forbid, with the argument that makes them so: an apply, or sudo with any.
const FORBIDDEN = new Map([
  ["sudo", null],
  ["doas", null],
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

// A variable that export, declare, unset and the like name: a protected one refuses, one the guard cannot read too.
const exported = (name: string, word: Word): Denial | null => {
  if (word.text === null && !word.start.includes("="))
    return unreadable(`${name} names a variable the guard cannot read`);
  const variable = /^[A-Za-z_]\w*/.exec(word.start)?.[0] ?? "";
  return PROTECTED.test(variable) ? deny("environment", `${name} ${variable}`) : null;
};

const checkExports = (name: string, args: readonly Word[]): Denial | null =>
  args.map((word) => exported(name, word)).find((denial) => denial !== null) ?? null;

// A shell runs the script after -c, the heredoc or here-string fed to it, or a file; one fed from a pipe is unread.
const checkShell = (name: string, args: readonly Word[], command: Command, context: Context): Denial | null => {
  const flag = args.findIndex(({ text }) => /^-[a-z]*c[a-z]*$/.test(text ?? ""));
  if (flag >= 0) {
    const script = args[flag + 1]?.text;
    return script === undefined || script === null
      ? unreadable(`${name} -c runs a script the guard cannot read`)
      : nested(script, context);
  }
  if (args.some(({ start }) => !start.startsWith("-"))) return null;
  const stdin = literal(command.stdin);
  if (stdin !== null && stdin.length > 0) return nested(stdin.join("\n"), context);
  return GUARDED.test(context.text)
    ? unreadable(`${name} reads a script from a pipe, which the guard cannot read`)
    : null;
};

const checkGit = (args: readonly Word[]): Denial | null => {
  const at = globalOptions(args);
  if ("rule" in at) return at;
  const [sub, ...rest] = args.slice(at.index);
  if (sub === undefined) return null;
  if (sub.text === null) return unreadable("git runs a subcommand the guard cannot read");
  if (!GIT_COMMANDS.has(sub.text)) {
    return unreadable(`git ${sub.text} is no git command the guard knows, and an alias may hide a push`);
  }
  return checkGitCommand(sub.text, rest);
};

// git's options before its subcommand: -c and --config-env change its configuration; the others are skipped with
// their values. The index of the subcommand.
const globalOptions = (args: readonly Word[]): Denial | { index: number } => {
  let i = 0;
  while ((args[i]?.start ?? "").startsWith("-")) {
    const option = args[i]?.start ?? "";
    if (option === "-c" || option.startsWith("--config-env")) return deny("git-config", `git ${option}`);
    i += ["-C", "--git-dir", "--work-tree", "--namespace", "--super-prefix"].includes(option) ? 2 : 1;
  }
  return { index: i };
};

const checkGitCommand = (sub: string, rest: readonly Word[]): Denial | null =>
  configChange(sub, rest) ?? skippedChecks(sub, rest) ?? networkCheck(sub, rest);

const configChange = (sub: string, rest: readonly Word[]): Denial | null => {
  if (sub === "config") return configWrite(rest) ? deny("git-config", "git config with a value") : null;
  const verb = rest[0]?.text ?? "";
  return sub === "remote" && REMOTE_CHANGES.has(verb) ? deny("git-config", `git remote ${verb}`) : null;
};

// --no-verify on a commit or push, and -n on a commit, skip the checks the repository's hooks run.
const skippedChecks = (sub: string, rest: readonly Word[]): Denial | null => {
  if (sub !== "commit" && sub !== "push") return null;
  if (rest.some(({ text }) => text === "--no-verify")) return deny("forbidden", `git ${sub} --no-verify`);
  return sub === "commit" && hasShortFlag(rest, "n", "mFCct", "uS") ? deny("forbidden", "git commit -n") : null;
};

const networkCheck = (sub: string, rest: readonly Word[]): Denial | null => {
  if (sub === "push") return checkPush(rest);
  return sub === "clone" ? checkClone(rest) : null;
};

// The git commands the guard knows; any other word may be an alias, which could hide a push.
const GIT_COMMANDS = new Set(
  (
    "add am annotate apply archive bisect blame branch bundle cat-file check-attr check-ignore check-mailmap " +
    "check-ref-format checkout checkout-index cherry cherry-pick citool clean clone commit commit-graph commit-tree " +
    "config count-objects describe diff diff-files diff-index diff-tree difftool fetch for-each-ref format-patch fsck " +
    "gc grep hash-object help init interpret-trailers lfs log ls-files ls-remote ls-tree merge merge-base merge-file " +
    "merge-tree mergetool mktag mktree mv name-rev notes pull push range-diff read-tree rebase reflog remote repack " +
    "replace rerere reset restore rev-list rev-parse revert rm shortlog show show-branch show-ref sparse-checkout " +
    "stash status stripspace submodule switch symbolic-ref tag update-index update-ref var verify-commit verify-pack " +
    "verify-tag version whatchanged worktree write-tree"
  ).split(" "),
);
const REMOTE_CHANGES = new Set(["add", "set-url", "rename", "remove", "rm", "set-branches"]);
const COMMIT_VALUED = new Set(
  "--message --file --author --date --template --fixup --squash --reuse-message --reedit-message --cleanup --trailer".split(
    " ",
  ),
);
const CONFIG_VALUED = new Set(["-f", "--file", "--blob", "--type", "--default", "--comment", "--value"]);
const CONFIG_WRITES = /^(?:--(?:unset|unset-all|add|replace-all|rename-section|remove-section|edit)|-e)$/;

const CONFIG_VERBS = new Set(["set", "unset", "rename-section", "remove-section", "edit"]);

// git config's positional words and whether an option writes.
const configWords = (rest: readonly Word[]): { positional: (string | null)[]; write: boolean } => {
  const positional: (string | null)[] = [];
  let write = false;
  for (let i = 0; i < rest.length; i += 1) {
    const text = rest[i]?.text ?? null;
    if (text === null || !text.startsWith("-")) positional.push(text);
    else if (CONFIG_VALUED.has(text)) i += 1;
    else write ||= CONFIG_WRITES.test(text);
  }
  return { positional, write };
};

// git config with a value, a write option or a writing subcommand; `get` and `list` and a lone key read.
const configWrite = (rest: readonly Word[]): boolean => {
  const { positional, write } = configWords(rest);
  const verb = positional[0] ?? "";
  if (verb === "get" || verb === "list") return false;
  return write || CONFIG_VERBS.has(verb) || positional.length > 1;
};

// What a short-option cluster such as -am does with `letter`: holds it, takes the next word as a value, or neither.
const inCluster = (text: string, letter: string, valued: string, attached: string): "found" | "value" | "none" => {
  for (let k = 1; k < text.length; k += 1) {
    const c = text.charAt(k);
    if (attached.includes(c)) return "none";
    if (c === letter) return "found";
    if (valued.includes(c)) return k === text.length - 1 ? "value" : "none";
  }
  return "none";
};

// What an option word does: a short cluster with `letter`, a short or long option that takes the next word, or neither.
const optionOf = (text: string, letter: string, valued: string, attached: string): "found" | "value" | "none" => {
  if (/^-[A-Za-z]/.test(text)) return inCluster(text, letter, valued, attached);
  return COMMIT_VALUED.has(text) ? "value" : "none";
};

// Whether a short-option cluster before `--` holds `letter`, skipping the values of `valued` letters and long options.
const hasShortFlag = (rest: readonly Word[], letter: string, valued: string, attached: string): boolean => {
  for (let i = 0; i < rest.length; i += 1) {
    const text = rest[i]?.text ?? "";
    if (text === "--") return false;
    const found = optionOf(text, letter, valued, attached);
    if (found === "found") return true;
    if (found === "value") i += 1;
  }
  return false;
};

const checkPush = (rest: readonly Word[]): Denial | null => {
  const forced = rest.some(({ start }) => /^(?:--(?:force|mirror)|\+)/.test(start)) || hasShortFlag(rest, "f", "o", "");
  return forced ? deny("forbidden", "a forced git push") : null;
};

const checkClone = (rest: readonly Word[]): Denial | null =>
  rest.some(({ start }) => start === "-c" || start.startsWith("--config")) ? deny("git-config", "git clone -c") : null;
