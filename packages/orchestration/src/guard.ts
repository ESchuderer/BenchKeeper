import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { type GuardPolicy, RepoName } from "@cedarloom/contracts";
import { type Command, readShell, type Script, type Word } from "./shell.ts";

/** Why the guard refuses a call. */
export type Rule =
  | "unreadable"
  | "environment"
  | "git-config"
  | "gh-config"
  | "forbidden"
  | "outside-profiles"
  | "memory-main"
  | "issue-outside-hub"
  | "merge"
  | "approval";

export interface Denial {
  readonly rule: Rule;
  readonly detail: string;
}

/** The push URLs of a folder's git remotes by name; null when they cannot be read, as outside a repository. */
export type Remotes = (folder: string) => ReadonlyMap<string, readonly string[]> | null;

interface Context {
  readonly policy: GuardPolicy;
  readonly remotes: Remotes;
  readonly text: string;
  /** Every folder a command of the text may run in (the session's, and each literal `cd`); null when one is unknown. */
  readonly folders: readonly string[] | null;
  readonly depth: number;
}

const deny = (rule: Rule, detail: string): Denial => ({ rule, detail });
const unreadable = (detail: string): Denial => deny("unreadable", detail);

// A program the guard checks, named anywhere in a text, in any case, after a path or as git-<command>.
const GUARDED = /(?:^|[^\w.-])(?:gh|git|curl)\b/i;
// Variables that choose the token, gh's or git's configuration, the home both read it from, or git's repository (A13).
const PROTECTED_NAMES =
  "GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|GITHUB_ENTERPRISE_TOKEN|GH_CONFIG_DIR|GH_HOST|SSH_ASKPASS|HOME|" +
  // Every git variable but the pager's and the prompt's: they choose its repository, configuration, editor or programs.
  "XDG_CONFIG_HOME|GH_REPO|GIT_(?!(?:PAGER|TERMINAL_PROMPT)\\b)\\w+";
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

/** Whether the guard refuses the shell command `text`, run in the folder `folder`, and why; null to let it run. */
export const guardCommand = (text: string, folder: string, policy: GuardPolicy, remotes: Remotes): Denial | null => {
  const script = readShell(text);
  return checkScript(script, { policy, remotes, text, folders: foldersOf(script, [folder]), depth: 0 });
};

const home = (path: string): string => path.replace(/^~(?=\/|$)/, homedir());

// Where a cd or pushd goes: its literal folder, the home folder without one, or null for one the guard cannot read.
const cdTarget = (args: readonly Word[]): string | null => {
  const target = args.find(({ start }) => !start.startsWith("-"));
  if (target === undefined) return homedir();
  return target.text === null ? null : home(target.text);
};

// The folders a command may run in: those it starts in, and each literal `cd` or `pushd` from each of them.
const foldersOf = (script: Script, starts: readonly string[] | null): string[] | null => {
  if (starts === null) return null;
  const folders = new Set(starts);
  for (const command of script.commands) {
    const [name, ...args] = unwrap(command.words).words;
    if (!["cd", "pushd"].includes(name?.text ?? "")) continue;
    const to = cdTarget(args);
    if (to === null) return null;
    for (const folder of Array.from(folders)) folders.add(resolve(folder, to));
  }
  return Array.from(folders);
};

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
    : nestedScript(readShell(text), text, context);

const nestedScript = (script: Script, text: string, context: Context): Denial | null =>
  checkScript(script, { ...context, text, folders: foldersOf(script, context.folders), depth: context.depth + 1 });

interface Unwrapped {
  words: Word[];
  prefix: Word[];
  // xargs adds words it reads; env -i or exec -c clears the environment; env -S runs a word as a command line.
  appended: boolean;
  cleared: boolean;
  split: Word | null;
  // env -C runs the command in another folder.
  moved: boolean;
}

// The command's own words: assignments, reserved words and wrappers skipped, with the words before them (`prefix`).
const unwrap = (words: readonly Word[]): Unwrapped => {
  const found: Unwrapped = { words: [], prefix: [], appended: false, cleared: false, split: null, moved: false };
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
  found.moved ||= /^(?:-C|--chdir)/.test(option);
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
  return checkProgram(name, args, command, unwrapped.moved ? { ...context, folders: null } : context);
};

const checkProgram = (name: string, args: Word[], command: Command, context: Context): Denial | null => {
  if (name === "git") return checkGit(args, context);
  if (name === "gh") return checkGh(args, context);
  if (name === "curl") return checkCurl(args, context);
  if (name.startsWith("git-")) return checkGit([{ text: name.slice(4), start: name.slice(4) }, ...args], context);
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

// The commands find runs: the words after each -exec, -execdir, -ok or -okdir up to `;` or `+`, and whether they run
// in the folders of the files it finds (-execdir, -okdir).
const execSegments = (args: readonly Word[]): { words: Word[]; moved: boolean }[] => {
  const segments: { words: Word[]; moved: boolean }[] = [];
  let current: { words: Word[]; moved: boolean } | null = null;
  for (const word of args) {
    const exec = /^-(?:exec|execdir|ok|okdir)$/.exec(word.text ?? "")?.[0];
    if (current === null) current = exec === undefined ? null : { words: [], moved: exec.endsWith("dir") };
    else if (word.text === ";" || word.text === "+") {
      segments.push(current);
      current = null;
    } else current.words.push(word);
  }
  return current === null ? segments : [...segments, current];
};

const checkFind = (args: readonly Word[], context: Context): Denial | null =>
  execSegments(args)
    .map(({ words, moved }) => checkCommand({ words, stdin: [] }, moved ? { ...context, folders: null } : context))
    .find((denial) => denial !== null) ?? null;

const checkGit = (args: readonly Word[], context: Context): Denial | null => {
  const at = globalOptions(args, context);
  if ("rule" in at) return at;
  const [sub, ...rest] = args.slice(at.index);
  if (sub === undefined) return null;
  if (sub.text === null) return unreadable("git runs a subcommand the guard cannot read");
  if (!GIT_COMMANDS.has(sub.text)) {
    return unreadable(`git ${sub.text} is no git command the guard knows, and an alias may hide a push`);
  }
  return checkGitCommand(sub.text, rest, { ...context, folders: at.folders });
};

// The folders git works in after -C `value`, as git reaches them (a link and then `..` is no lexical step back); null when
// one of them, or the value, is unknown.
const moved = (folders: readonly string[] | null, value: Word | undefined): readonly string[] | null => {
  const to = value?.text;
  if (typeof to !== "string" || folders === null) return null;
  return folders.map((folder) => (isAbsolute(home(to)) ? home(to) : `${folder}/${to}`));
};

const GLOBAL_FLAGS = new Set(
  "-p --paginate -P --no-pager --bare --no-replace-objects --literal-pathspecs --glob-pathspecs --noglob-pathspecs " +
    "--icase-pathspecs --no-optional-locks --no-lazy-fetch --no-advice -v --version -h --help --html-path --man-path " +
    "--info-path --exec-path".split(" "),
);
const GLOBAL_VALUED = new Set(["--namespace", "--super-prefix", "--attr-source", "--list-cmds"]);

// One of git's options before its subcommand: -c and --config-env change its configuration, -C moves it, --git-dir and
// --work-tree name a repository the guard does not look up, --exec-path= runs git's commands from elsewhere, and an
// option the guard does not know may take the subcommand as its value. How many words it takes, and git's folders.
const globalOption = (
  option: string,
  value: Word | undefined,
  folders: readonly string[] | null,
): Denial | { taken: number; folders: readonly string[] | null } => {
  const name = option.split("=")[0] ?? "";
  if (option.startsWith("-c") || name === "--config-env") return deny("git-config", `git ${name}`);
  if (option === "-C") return { taken: 2, folders: moved(folders, value) };
  const taken = option.includes("=") ? 1 : 2;
  if (name === "--git-dir" || name === "--work-tree") return { taken, folders: null };
  if (GLOBAL_VALUED.has(name)) return { taken, folders };
  return GLOBAL_FLAGS.has(option)
    ? { taken: 1, folders }
    : unreadable(`git ${name} is an option the guard does not know`);
};

const globalOptions = (
  args: readonly Word[],
  context: Context,
): Denial | { index: number; folders: readonly string[] | null } => {
  let { folders } = context;
  let i = 0;
  while ((args[i]?.start ?? "").startsWith("-")) {
    const step = globalOption(args[i]?.start ?? "", args[i + 1], folders);
    if ("rule" in step) return step;
    folders = step.folders;
    i += step.taken;
  }
  return { index: i, folders };
};

const checkGitCommand = (sub: string, rest: readonly Word[], context: Context): Denial | null =>
  unknownWord(sub, rest) ??
  configChange(sub, rest) ??
  skippedChecks(sub, rest) ??
  ranCommand(sub, rest) ??
  networkCheck(sub, rest, context);

const networkCheck = (sub: string, rest: readonly Word[], context: Context): Denial | null => {
  if (sub === "push")
    return checkPush(rest) ?? submodules(sub, rest, context) ?? checkTargets(sub, pushTargets(rest), context);
  if (sub === "clone")
    return (
      checkClone(rest) ??
      submodules(sub, rest, context) ??
      checkTargets(sub, positionals(sub, rest).slice(0, 1), context)
    );
  if (sub === "fetch" || sub === "pull") return submodules(sub, rest, context) ?? fetchTargets(sub, rest, context);
  return otherTargets(sub, rest, context);
};

// git fetch --multiple names a repository in each positional; otherwise the first one is the repository.
const fetchTargets = (sub: string, rest: readonly Word[], context: Context): Denial | null => {
  const words = positionals(sub, rest);
  if (!rest.some(({ text }) => text === "--multiple")) return checkTargets(sub, words, context);
  return words.map((word) => checkTargets(sub, [word], context)).find((denial) => denial !== null) ?? null;
};

// Other commands that reach a remote: ls-remote, maintenance (its prefetch reaches every remote), remote, archive and
// submodule.
const otherTargets = (sub: string, rest: readonly Word[], context: Context): Denial | null => {
  if (sub === "ls-remote") return checkTargets("fetch", positionals(sub, rest), context);
  if (sub === "maintenance") return checkTargets("fetch", [], context);
  if (sub === "remote") return remoteTargets(rest, context);
  if (sub === "archive") return archiveTargets(rest, context);
  return sub === "submodule" ? submoduleCheck(rest, context) : null;
};

// git remote update reaches every remote; show and prune reach the remote they name, unless -n keeps them local.
const remoteTargets = (rest: readonly Word[], context: Context): Denial | null => {
  const verb = verbOf(rest);
  if (verb === "update") return checkTargets("fetch", [], context);
  if (!["show", "prune"].includes(verb) || rest.some(({ text }) => text === "-n")) return null;
  const after = rest.slice(rest.findIndex(({ text }) => text === verb) + 1);
  return checkTargets("fetch", after.filter(({ start }) => !start.startsWith("-")).slice(0, 1), context);
};

// git archive --remote reaches the repository it names.
const archiveTargets = (rest: readonly Word[], context: Context): Denial | null => {
  const index = rest.findIndex(({ start }) => start.startsWith("--remote"));
  const remote = rest[index];
  if (remote === undefined) return null;
  const value =
    remote.start === "--remote" ? rest[index + 1] : { text: remote.text?.slice("--remote=".length) ?? null, start: "" };
  return checkTargets("fetch", value === undefined ? [] : [value], context);
};

// git submodule add, update and sync reach repositories the guard does not look up; status and summary stay local.
const submoduleCheck = (rest: readonly Word[], context: Context): Denial | null =>
  context.policy.repositories !== null && !["", "status", "summary"].includes(verbOf(rest))
    ? unreadable("git submodule reaches repositories the guard does not look up")
    : null;

// --recurse-submodules (other than =no or =check) makes a push, fetch or clone reach the submodules' own repositories.
const submodules = (sub: string, rest: readonly Word[], context: Context): Denial | null => {
  const recurse = rest.find((word) => abbreviates(word, "--recurse-submodules", 5));
  const reaches = recurse !== undefined && !/=(?:no|check)$/.test(recurse.text ?? "");
  const limited = context.policy.repositories !== null || (sub === "push" && context.policy.memory !== null);
  return reaches && limited
    ? unreadable(`git ${sub} --recurse-submodules reaches repositories the guard does not look up`)
    : null;
};

// Whether `word`'s option name abbreviates the long option `option` to at least `min` characters, as git accepts; a word
// the guard cannot read is named by its literal start, such as `--force-with-lease=` before an expansion.
const abbreviates = (word: Word, option: string, min: number): boolean => {
  const name = (word.text ?? (word.start.includes("=") ? word.start : "")).split("=")[0] ?? "";
  return name.length >= min && option.startsWith(name);
};

interface Valued {
  readonly short: string;
  readonly long: readonly string[];
}

const FETCH_LONG = [
  "--depth",
  "--deepen",
  "--shallow-since",
  "--shallow-exclude",
  "--jobs",
  "--upload-pack",
  "--refmap",
  "--server-option",
  "--negotiation-tip",
  "--filter",
  "--recurse-submodules",
];
const NONE: Valued = { short: "", long: [] };

// The git commands whose options the guard checks, and their options that take the next word as a value.
const VALUED = new Map<string, Valued>([
  ["commit", { short: "mFCct", long: ["--message", "--file", "--author", "--date", "--template", "--trailer"] }],
  ["merge", { short: "mFsX", long: ["--message", "--file", "--strategy", "--strategy-option"] }],
  ["pull", { short: "jsX", long: [...FETCH_LONG, "--strategy", "--strategy-option"] }],
  ["fetch", { short: "jo", long: FETCH_LONG }],
  ["push", { short: "o", long: ["--push-option", "--repo", "--receive-pack", "--exec", "--recurse-submodules"] }],
  ["ls-remote", { short: "o", long: ["--upload-pack", "--server-option", "--sort"] }],
  [
    "clone",
    {
      short: "objuc",
      long: [
        "--branch",
        "--origin",
        "--depth",
        "--reference",
        "--reference-if-able",
        "--template",
        "--upload-pack",
        "--separate-git-dir",
        "--filter",
        "--jobs",
        "--shallow-since",
        "--shallow-exclude",
        "--server-option",
        "--bundle-uri",
        "--ref-format",
        "--config",
      ],
    },
  ],
  ...["config", "remote", "rebase", "am", "cherry-pick", "revert", "submodule", "bisect", "archive"].map(
    (name): [string, Valued] => [name, NONE],
  ),
]);

// Whether an option word takes the next word as its value: a long option or an abbreviation of one, without `=`, or a
// short cluster that ends in a letter that takes one.
const takesValue = (text: string, valued: Valued): boolean => {
  if (text.startsWith("--"))
    return !text.includes("=") && valued.long.some((option) => text.length >= 4 && option.startsWith(text));
  return /^-[^-]+$/.test(text) && valued.short.includes(text.at(-1) ?? " ");
};

// A word of a checked command that the guard cannot read could be an option, such as one that forces a push; the value
// of an option before it, or one attached to an option (--message="$M", -m"$M"), is no option.
const unknownWord = (sub: string, rest: readonly Word[]): Denial | null => {
  const valued = VALUED.get(sub);
  if (valued === undefined) return null;
  const hidden = rest.find(({ text, start }, i) => {
    const attached =
      /^--[\w-]+=/.test(start) || (/^-[A-Za-z]+$/.test(start) && valued.short.includes(start.at(-1) ?? " "));
    return (
      text === null && !attached && /^[-+]?$/.test(start.charAt(0)) && !takesValue(rest[i - 1]?.text ?? "", valued)
    );
  });
  return hidden === undefined
    ? null
    : unreadable(`git ${sub} gets a word the guard cannot read, which may be an option`);
};

// The git commands the guard knows; any other word may be an alias, which could hide a push.
const GIT_COMMANDS = new Set(
  (
    "add am annotate apply archive bisect blame branch bundle cat-file check-attr check-ignore check-mailmap " +
    "check-ref-format checkout checkout-index cherry cherry-pick citool clean clone commit commit-graph commit-tree " +
    "config count-objects describe diff diff-files diff-index diff-tree difftool fetch for-each-ref format-patch fsck " +
    "gc grep hash-object help hook init interpret-trailers lfs log ls-files ls-remote ls-tree maintenance merge " +
    "merge-base merge-file merge-tree mergetool mktag mktree mv name-rev notes pack-refs prune pull push range-diff " +
    "read-tree rebase reflog remote repack replace rerere reset restore rev-list rev-parse revert rm shortlog show " +
    "show-branch show-ref sparse-checkout stash status stripspace submodule switch symbolic-ref tag update-index " +
    "update-ref var verify-commit verify-pack verify-tag version whatchanged worktree write-tree"
  ).split(" "),
);
const REMOTE_CHANGES = new Set(["add", "set-url", "rename", "remove", "rm", "set-branches"]);
const CONFIG_VALUED = new Set(["-f", "--file", "--blob", "--type", "--default", "--comment", "--value"]);
const CONFIG_WRITES = [
  "--unset",
  "--unset-all",
  "--add",
  "--replace-all",
  "--rename-section",
  "--remove-section",
  "--edit",
];
// A command's first word that is no option, such as `add` in `git remote -v add`.
const verbOf = (rest: readonly Word[]): string => rest.find(({ start }) => !start.startsWith("-"))?.text ?? "";
const CONFIG_VERBS = new Set(["set", "unset", "rename-section", "remove-section", "edit"]);

const configChange = (sub: string, rest: readonly Word[]): Denial | null => {
  if (sub === "config") return configWrite(rest) ? deny("git-config", "git config with a value") : null;
  const verb = verbOf(rest);
  return sub === "remote" && REMOTE_CHANGES.has(verb) ? deny("git-config", `git remote ${verb}`) : null;
};

// git config's positional words and whether an option writes.
const configWords = (rest: readonly Word[]): { positional: (string | null)[]; write: boolean } => {
  const positional: (string | null)[] = [];
  let write = false;
  for (let i = 0; i < rest.length; i += 1) {
    const text = rest[i]?.text ?? null;
    if (text === null || !text.startsWith("-")) positional.push(text);
    else if (CONFIG_VALUED.has(text)) i += 1;
    else write ||= text === "-e" || CONFIG_WRITES.some((option) => abbreviates({ text, start: text }, option, 4));
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

// --no-verify, abbreviated as git allows, skips the checks a repository's hooks run on any command; so does a
// commit's -n.
const skippedChecks = (sub: string, rest: readonly Word[]): Denial | null => {
  if (rest.some((word) => abbreviates(word, "--no-verify", 6))) return deny("forbidden", `git ${sub} --no-verify`);
  return sub === "commit" && hasShortFlag(rest, "n", "mFCct", "uS") ? deny("forbidden", "git commit -n") : null;
};

// The options with which git runs a program of the caller's choosing, per command.
const RUNNER_OPTIONS = new Map<string, readonly string[]>([
  ["rebase", ["--exec"]],
  ["push", ["--receive-pack", "--exec"]],
  ["fetch", ["--upload-pack"]],
  ["pull", ["--upload-pack"]],
  ["clone", ["--upload-pack"]],
  ["ls-remote", ["--upload-pack", "--exec"]],
  ["archive", ["--exec"]],
  ["difftool", ["--extcmd"]],
]);
// Options and commands with which git runs a command or program of its own choosing, which the guard does not read.
const RUNS: readonly ((sub: string, rest: readonly Word[]) => boolean)[] = [
  (sub, rest) => rest.some((word) => (RUNNER_OPTIONS.get(sub) ?? []).some((option) => abbreviates(word, option, 3))),
  (sub, rest) => ["rebase", "difftool", "mergetool"].includes(sub) && hasShortFlag(rest, "x", "", ""),
  (sub, rest) => ["clone", "ls-remote"].includes(sub) && hasShortFlag(rest, "u", "objc", ""),
  (sub, rest) => sub === "submodule" && rest.some(({ text }) => text === "foreach"),
  (sub, rest) => sub === "bisect" && rest[0]?.text === "run",
];

const ranCommand = (sub: string, rest: readonly Word[]): Denial | null =>
  RUNS.some((runs) => runs(sub, rest)) ? unreadable(`git ${sub} runs a command the guard does not read`) : null;

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

// Whether a short-option cluster before `--` holds `letter`, skipping the values of `valued` letters.
const hasShortFlag = (rest: readonly Word[], letter: string, valued: string, attached: string): boolean => {
  for (let i = 0; i < rest.length; i += 1) {
    const text = rest[i]?.text ?? "";
    if (text === "--") return false;
    const found = /^-[^-]/.test(text) ? inCluster(text, letter, valued, attached) : "none";
    if (found === "found") return true;
    if (found === "value") i += 1;
  }
  return false;
};

// A forced push: --force and its abbreviations, --force-with-lease, --mirror, -f in a cluster, or a +refspec.
const checkPush = (rest: readonly Word[]): Denial | null => {
  const forced = rest.some(
    ({ text, start }) =>
      (abbreviates({ text, start }, "--force", 5) && text !== "--force-if-includes") ||
      abbreviates({ text, start }, "--force-with-lease", 9) ||
      abbreviates({ text, start }, "--mirror", 4) ||
      start.startsWith("+"),
  );
  return forced || hasShortFlag(rest, "f", "o", "") ? deny("forbidden", "a forced git push") : null;
};

const checkClone = (rest: readonly Word[]): Denial | null =>
  hasShortFlag(rest, "c", "obuj", "") || rest.some((word) => abbreviates(word, "--config", 4))
    ? deny("git-config", "git clone -c")
    : null;

// The words of a command that are no option or option value; every word after `--`.
const positionals = (sub: string, rest: readonly Word[]): Word[] => {
  const valued = VALUED.get(sub) ?? NONE;
  const found: Word[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const word = rest[i] ?? EMPTY;
    if (word.text === "--") return [...found, ...rest.slice(i + 1)];
    if (takesValue(word.text ?? "", valued)) i += 1;
    else if (!word.start.startsWith("-")) found.push(word);
  }
  return found;
};

// The repository a push names and its refspecs: the first positional, else the value of --repo.
const pushTargets = (rest: readonly Word[]): Word[] => {
  const words = positionals("push", rest);
  const option = rest.findIndex(({ start }) => start === "--repo" || start.startsWith("--repo="));
  if (words.length > 0 || option < 0) return words;
  const named = rest[option]?.start === "--repo" ? rest[option + 1] : rest[option];
  return named === undefined ? [] : [{ text: named.text?.replace(/^--repo=/, "") ?? null, start: "" }];
};

// A remote's URL or an scp-like address, as opposed to a remote's name or a local path.
// A local repository by its path, which reaches no GitHub repository.
const isLocal = (text: string): boolean => /^(?:\.{1,2}|~)?$|^(?:\.{1,2}|~)?\/|^file:\/\//.test(text);

const isUrl = (text: string): boolean =>
  /^[a-z][\w+.-]*:\/\//i.test(text) || /^(?:[^\s/@:]+@)?[^\s/@:]+\.[^\s/@:]+:/.test(text);

/** The GitHub repository a remote URL names, as owner/name; null for any other host or form. */
const githubRepo = (url: string): string | null => {
  const scp = /^(?:[^\s/@:]+@)?(?:www\.)?github\.com:/i.exec(url);
  let path: string;
  if (scp === null) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (!/^(?:www\.)?github\.com$/i.test(parsed.hostname)) return null;
    path = parsed.pathname;
  } else path = url.slice(scp[0].length);
  const name = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  return RepoName.safeParse(name).success ? name : null;
};

// The URLs of a remote by name in a folder's remotes, or of every remote without a name; null for none.
const remotesOf = (remotes: ReturnType<Remotes>, name: string | undefined): readonly string[] | null => {
  if (remotes === null) return null;
  return name === undefined ? [...remotes.values()].flat() : (remotes.get(name) ?? null);
};

// The URLs a git network command reaches: the URL it names, the remote it names in every folder it may run in, or
// every remote of those folders; none for a local path; null when the guard cannot tell, such as a name that is no
// remote, which git takes as a path or a transport address.
const urlsOf = (word: Word | undefined, context: Context): string[] | null => {
  const name = word?.text;
  if (name === null || context.folders === null) return null;
  if (name !== undefined && isUrl(name)) return [name];
  if (name !== undefined && isLocal(name)) return [];
  const urls: string[] = [];
  for (const folder of context.folders) {
    const found = remotesOf(context.remotes(folder), name);
    if (found === null) return null;
    urls.push(...found);
  }
  return urls;
};

const sameRepo = (a: string | null, b: string | null): boolean =>
  a !== null && b !== null && a.toLowerCase() === b.toLowerCase();

// A push to the memory repository goes to proposal branches only: each refspec literal, its destination under memory/.
const proposals = (refspecs: readonly Word[]): boolean =>
  refspecs.length > 0 &&
  refspecs.every(
    ({ text }) => text !== null && /^(?:refs\/heads\/)?memory\/[^:]+$/.test(text.slice(text.lastIndexOf(":") + 1)),
  );

const checkUrl = (sub: string, url: string, refspecs: readonly Word[], policy: GuardPolicy): Denial | null => {
  const repo = githubRepo(url);
  if (policy.repositories !== null && !policy.repositories.some((allowed) => sameRepo(allowed, repo))) {
    return deny("outside-profiles", `git ${sub} reaches ${repo ?? url}, outside this session's repositories`);
  }
  return sub === "push" && policy.memory !== null ? memoryPush(url, repo, refspecs, policy.memory) : null;
};

// A push to the memory repository other than to proposal branches; to a URL the guard cannot compare with it, unless
// that is a local path.
const memoryPush = (url: string, repo: string | null, refspecs: readonly Word[], memory: string): Denial | null => {
  if (repo === null) {
    return isLocal(url)
      ? null
      : unreadable(`git push reaches ${url}, which the guard cannot compare with the memory repository`);
  }
  return sameRepo(repo, memory) && !proposals(refspecs)
    ? deny("memory-main", "git push may update main of the memory repository; push a memory/<name> branch")
    : null;
};

const checkTargets = (sub: string, words: readonly Word[], context: Context): Denial | null => {
  const { repositories, memory } = context.policy;
  if (repositories === null && (sub !== "push" || memory === null)) return null;
  const urls = urlsOf(words[0], context);
  if (urls === null) return unreadable(`git ${sub} reaches a repository the guard cannot tell`);
  return (
    urls.map((url) => checkUrl(sub, url, words.slice(1), context.policy)).find((denial) => denial !== null) ?? null
  );
};

// owner/name of a github.com URL, whatever its path goes on with; null for another host.
const urlRepoPath = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    if (!/^(?:www\.)?github\.com$/i.test(parsed.hostname)) return null;
    return parsed.pathname.split("/").filter(Boolean).slice(0, 2).join("/");
  } catch {
    return null;
  }
};

// The repository a gh word names: owner/name, [HOST/]owner/name or a github.com URL; null off github.com.
const ghRepo = (text: string): string | null => {
  const path = /^https?:\/\//i.test(text) ? urlRepoPath(text) : text.replace(/^github\.com\//i, "");
  return path === null ? null : githubRepo(`https://github.com/${path}`);
};

// The repositories a call reaches without naming one: those of the remotes of every folder it may run in, as gh picks
// one of them; null when the guard cannot tell, or when there is none.
const implicitRepos = (context: Context): (string | null)[] | null => {
  const urls = urlsOf(undefined, context);
  return urls === null || urls.length === 0 ? null : urls.map(githubRepo);
};

// A call that reaches `repos` (null: unknown) while the session is limited to its repositories.
const checkRepos = (repos: readonly (string | null)[] | null, context: Context, what: string): Denial | null => {
  const { repositories } = context.policy;
  if (repositories === null) return null;
  if (repos === null) return unreadable(`${what} reaches a repository the guard cannot tell`);
  const outside = repos.find((repo) => !repositories.some((allowed) => sameRepo(allowed, repo)));
  return outside === undefined
    ? null
    : deny(
        "outside-profiles",
        `${what} reaches ${outside ?? "a host other than github.com"}, outside this session's repositories`,
      );
};

// Issues are worked on in the hub only (A3): a call on issues of any other repository, or of one the guard cannot tell.
const checkHub = (repos: readonly (string | null)[] | null, context: Context, what: string): Denial | null => {
  const { hub } = context.policy;
  const elsewhere = repos === null || hub === null || repos.some((repo) => !sameRepo(repo, hub));
  return elsewhere ? deny("issue-outside-hub", `${what} works on issues outside the hub`) : null;
};

// gh's flags that take the next word as a value, across its commands.
const GH_VALUED = new Set(
  (
    "-R --repo --hostname -X --method -f --field -F --raw-field -H --header --input -q --jq -t --template -b --body " +
    "--body-file -T --title -l --label -B --base --head -a --assignee -r --reviewer -m --milestone -p --project " +
    "-L --limit -s --state -A --author -S --search -w --workflow -b --branch -e --env -o --org -u --user"
  ).split(" "),
);

// gh's subcommand: the first word after its command that is no flag, values of flags skipped; and the other words.
const ghVerb = (args: readonly Word[]): { verb: Word | undefined; rest: Word[] } => {
  for (let i = 0; i < args.length; i += 1) {
    const start = args[i]?.start ?? "";
    if (GH_VALUED.has(start)) i += 1;
    else if (!start.startsWith("-")) return { verb: args[i], rest: args.filter((_, j) => j !== i) };
  }
  return { verb: undefined, rest: [...args] };
};

// What gh commands do that the guard refuses whatever the repository: a login or configuration change of gh itself, or
// a write the owner keeps (a secret, a repository's creation or settings, a release, anything public; A13).
const GH_CONFIG =
  /^(?:auth (?!status$)\S+|config (?:set|clear-cache)|alias (?:set|delete|import)|extension (?!list$|search$|browse$)\S+|(?:ssh|gpg)-key (?:add|delete))$/;
const GH_OWNER =
  /^(?:(?:secret|variable) (?!list$)\S+|repo (?:create|delete|edit|rename|archive|unarchive|fork|deploy-key|set-default)|release (?:create|edit|delete|upload|delete-asset)|gist (?:create|edit|delete|rename|clone)|codespace \S+|ruleset \S+)$/;
// Commands that work on no repository and write nothing.
const GH_FREE =
  /^(?:search|status|help|version|completion|org list|project (?:list|view)|attestation verify|auth status|config (?:get|list)|alias list|extension (?:list|search|browse)|gist (?:list|view)|(?:ssh|gpg)-key list|secret list|variable list)\b/;
// Commands on one repository, its issues, pull requests, runs and so on.
const GH_REPO_GROUPS = new Set([
  "issue",
  "pr",
  "repo",
  "run",
  "workflow",
  "release",
  "label",
  "cache",
  "browse",
  "ruleset",
]);

const checkGh = (args: readonly Word[], context: Context): Denial | null => {
  const at = args.findIndex(({ start }) => !start.startsWith("-"));
  const group = args[at];
  if (group === undefined) return null;
  if (group.text === null) return unreadable("gh runs a command the guard cannot read");
  if (group.text === "api") return checkGhApi(args.slice(at + 1), context);
  const { verb, rest } = ghVerb(args.slice(at + 1));
  if (verb?.text === null) return unreadable("gh runs a command the guard cannot read");
  const command = verb === undefined ? group.text : `${group.text} ${verb.text}`;
  return ghRule(command, rest) ?? ghTargets(group.text, command, rest, context);
};

// What the guard refuses in gh whatever the repository.
const ghRule = (command: string, rest: readonly Word[]): Denial | null => {
  if (GH_CONFIG.test(command)) return deny("gh-config", `gh ${command}`);
  if (GH_OWNER.test(command)) return deny("forbidden", `gh ${command}, which the owner keeps`);
  if (command === "pr merge") return deny("merge", "gh pr merge");
  return command === "pr review" && approves(rest) ? deny("approval", "gh pr review --approve") : null;
};

// The repository a gh command works on, and the hub for issue commands.
const ghTargets = (group: string, command: string, rest: readonly Word[], context: Context): Denial | null => {
  if (GH_FREE.test(command)) return null;
  if (!GH_REPO_GROUPS.has(group)) return unreadable(`gh ${command} is a gh command the guard does not know`);
  const repos = ghRepos(group, rest, context);
  return (
    checkRepos(repos, context, `gh ${command}`) ??
    (group === "issue" ? checkHub(repos, context, `gh ${command}`) : null)
  );
};

// gh pr review approves with --approve or -a, alone or in a cluster.
const approves = (rest: readonly Word[]): boolean =>
  rest.some(({ text, start }) =>
    text === null ? /^-[^-]/.test(start) : abbreviates({ text, start }, "--approve", 4) || /^-[^-]*a/.test(text),
  );

// The value of gh's -R or --repo, attached or as the next word: undefined without one, null when unknown.
const repoOption = (rest: readonly Word[]): string | null | undefined => {
  const index = rest.findIndex(({ start }) => /^(?:-R|--repo)(?:=|$)/.test(start));
  if (index < 0) return undefined;
  const word = rest[index];
  if (word?.start.includes("=") !== true) return rest[index + 1]?.text ?? null;
  return word.text?.replace(/^(?:-R|--repo)=/, "") ?? null;
};

// The repositories a gh command reaches: its --repo, the repository a `gh repo view|clone` names, a github.com URL among
// its words, or those of the remotes where it runs.
const ghRepos = (group: string, rest: readonly Word[], context: Context): (string | null)[] | null => {
  const option = repoOption(rest);
  const named = group === "repo" ? rest.find(({ start }) => !start.startsWith("-")) : undefined;
  const url = rest.find(({ text }) => text !== null && /^https?:\/\/(?:www\.)?github\.com\//i.test(text));
  const text = option !== undefined ? option : (named ?? url)?.text;
  if (text === null) return null;
  return text === undefined ? implicitRepos(context) : [ghRepo(text)];
};

// The fields of a gh api call (-f, -F, --field, --raw-field) by name, null for a value the guard cannot read or one read
// from a file (@file); `input`: a body read from --input.
const apiFields = (rest: readonly Word[]): { fields: Map<string, string | null>; input: boolean } => {
  const fields = new Map<string, string | null>();
  rest.forEach(({ start }, i) => {
    const field = rest[i + 1];
    if (!/^(?:-f|-F|--field|--raw-field)$/.test(start) || field === undefined) return;
    const name = /^[^=]+/.exec(field.start)?.[0] ?? "";
    const value = field.text === null ? null : field.text.slice(name.length + 1);
    fields.set(name, value?.startsWith("@") === false ? value : null);
  });
  return { fields, input: rest.some(({ start }) => start.startsWith("--input")) };
};

// gh api's method: -X or --method, else POST when it sends fields or a body, else GET; undefined when unknown.
const apiMethod = (rest: readonly Word[], sends: boolean): string | undefined => {
  const at = rest.findIndex(({ start }) => start === "-X" || start === "--method");
  if (at >= 0) return rest[at + 1]?.text?.toUpperCase();
  return sends ? "POST" : "GET";
};

// The event of a review a call sends: "" without one, null when the guard cannot read it.
const eventOf = (fields: ReadonlyMap<string, string | null>, input: boolean): string | null => {
  if (input) return null;
  return fields.has("event") ? (fields.get("event") ?? null) : "";
};

const checkGhApi = (rest: readonly Word[], context: Context): Denial | null => {
  const endpoint = rest.find(({ start }, i) => !start.startsWith("-") && !GH_VALUED.has(rest[i - 1]?.start ?? ""));
  const { fields, input } = apiFields(rest);
  const method = apiMethod(rest, fields.size > 0 || input);
  const path = endpoint?.text;
  if (typeof path !== "string" || method === undefined) {
    return unreadable("gh api calls an endpoint or method the guard cannot read");
  }
  if (path === "graphql")
    return checkGraphql(fields.has("query") ? (fields.get("query") ?? null) : null, input, context);
  return checkApiPath(method, path.replace(/^https:\/\/api\.github\.com/i, ""), eventOf(fields, input), context);
};

// A REST call on GitHub's API, from gh api or curl: the repository it reaches, issues on the hub only, no merge, no
// approving review (`event`: the review's event, null when the guard cannot read it), no content written to the memory
// repository; a write outside a repository's endpoints the guard does not know.
const checkApiPath = (method: string, path: string, event: string | null, context: Context): Denial | null => {
  const what = `${method} ${path}`;
  const match = /^\/?repos\/([^/]+)\/([^/?#]+)(\/[^?#]*)?/.exec(path);
  if (match === null) return method === "GET" ? null : unreadable(`${what} is a GitHub write the guard does not know`);
  const [, owner = "", name = "", rest = ""] = match;
  const repos = owner === "{owner}" || name === "{repo}" ? implicitRepos(context) : [ghRepo(`${owner}/${name}`)];
  return checkRepos(repos, context, what) ?? checkRestPath(method, rest, { repos, event, what }, context);
};

const merges = (method: string, rest: string): boolean =>
  (method === "PUT" && /^\/pulls\/[^/]+\/merge\/?$/.test(rest)) || (method === "POST" && /^\/merges\/?$/.test(rest));

// A review created or submitted with APPROVE, or with an event the guard cannot read.
const approvesReview = (method: string, rest: string, event: string | null): boolean =>
  method === "POST" &&
  /^\/pulls\/[^/]+\/reviews(?:\/[^/]+\/events)?\/?$/.test(rest) &&
  (event === null || /^approve$/i.test(event));

// Contents or refs written in the memory repository, or in repositories the guard cannot tell, which commit to main.
const writesMemory = (method: string, rest: string, repos: (string | null)[] | null, memory: string | null): boolean =>
  memory !== null &&
  method !== "GET" &&
  /^\/(?:contents|git\/refs)(?:\/|$)/.test(rest) &&
  repos?.some((repo) => sameRepo(repo, memory)) !== false;

const checkRestPath = (
  method: string,
  rest: string,
  { repos, event, what }: { repos: (string | null)[] | null; event: string | null; what: string },
  context: Context,
): Denial | null => {
  if (/^\/issues(?:\/|$)/.test(rest)) return checkHub(repos, context, what);
  if (merges(method, rest)) return deny("merge", what);
  if (approvesReview(method, rest, event)) return deny("approval", what);
  return writesMemory(method, rest, repos, context.policy.memory)
    ? deny("memory-main", `${what} may write the memory repository's main`)
    : null;
};

// gh api graphql: a merge or an approving review refuses; so does any other mutation and any query while the session is
// limited to repositories, as the guard cannot tell what a GraphQL document reaches.
const checkGraphql = (query: string | null, input: boolean, context: Context): Denial | null => {
  if (query === null || input) return unreadable("gh api graphql sends a document the guard cannot read");
  if (/\b(?:mergePullRequest|enablePullRequestAutoMerge)\b/.test(query))
    return deny("merge", "a merge through GraphQL");
  if (
    /\b(?:addPullRequestReview|submitPullRequestReview)\b/.test(query) &&
    !/\bevent\s*:\s*(?:COMMENT|REQUEST_CHANGES)\b/.test(query)
  ) {
    return deny("approval", "a review through GraphQL that may approve");
  }
  if (
    /\b(?:create|update|close|reopen|delete|transfer|pin|unpin)Issue\b|\b(?:addComment|addLabelsToLabelable|removeLabelsFromLabelable)\b/.test(
      query,
    )
  ) {
    return unreadable("a GraphQL write on issues whose repository the guard cannot tell");
  }
  return context.policy.repositories === null
    ? null
    : unreadable("gh api graphql reaches repositories the guard cannot tell");
};

// curl's options that take the next word, the ones that send a body, and the ones it reads more options from.
const CURL_VALUED = new Set(
  "-X --request -H --header -d --data --data-raw --data-binary --data-urlencode --data-ascii -F --form --json -T --upload-file -o --output -u --user -A --user-agent -e --referer -b --cookie -c --cookie-jar -w --write-out -m --max-time --connect-timeout --retry -x --proxy --url".split(
    " ",
  ),
);
const CURL_BODY = /^(?:-d|--data(?:-raw|-binary|-urlencode|-ascii)?|-F|--form|--json|-T|--upload-file)$/;

// curl's method: -X or --request, else POST when it sends a body, else GET; undefined when unknown.
const curlMethod = (args: readonly Word[], body: boolean): string | undefined => {
  const at = args.findIndex(({ start }) => start === "-X" || start === "--request");
  if (at >= 0) return args[at + 1]?.text?.toUpperCase();
  return body ? "POST" : "GET";
};

// curl's URLs: its words that are no option or option value, and the value of --url.
const curlUrls = (args: readonly Word[]): Word[] =>
  args.filter(({ start }, i) => {
    const before = args[i - 1]?.start ?? "";
    return !start.startsWith("-") && (!CURL_VALUED.has(before) || before === "--url");
  });

// curl to GitHub: each URL it reaches, checked as gh api or git would be; a URL or config file it cannot read refuses.
const checkCurl = (args: readonly Word[], context: Context): Denial | null => {
  if (args.some(({ start }) => /^(?:-K|--config)/.test(start))) return unreadable("curl reads options from a file");
  const body = args.some(({ start }) => CURL_BODY.test(start));
  const method = curlMethod(args, body);
  const urls = curlUrls(args);
  if (method === undefined || urls.some(({ text }) => text === null)) {
    return unreadable("curl reaches a URL or uses a method the guard cannot read");
  }
  return urls.map(({ text }) => curlUrl(text ?? "", method, body, context)).find((denial) => denial !== null) ?? null;
};

const curlUrl = (url: string, method: string, body: boolean, context: Context): Denial | null => {
  let parsed: URL;
  try {
    parsed = new URL(/^[a-z][\w+.-]*:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    return unreadable(`curl reaches ${url}, which the guard cannot read`);
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "api.github.com" || host === "uploads.github.com") {
    return checkApiPath(method, parsed.pathname, body ? null : "", context);
  }
  if (!/(?:^|\.)github(?:usercontent)?\.com$/.test(host)) return null;
  const [owner = "", name = ""] = parsed.pathname.split("/").filter(Boolean);
  return checkRepos([ghRepo(`${owner}/${name.replace(/\.git$/i, "")}`)], context, `curl ${host}`);
};
