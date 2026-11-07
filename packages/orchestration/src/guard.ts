import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { type GuardPolicy, RepoName } from "@cedarloom/contracts";
import { type Command, RESERVED, readShell, type Script, type Word } from "./shell.ts";

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
  /** Every folder a command of the text may run in (the session's, and each literal `cd`); null when one is unknown. */
  readonly folders: readonly string[] | null;
}

const deny = (rule: Rule, detail: string): Denial => ({ rule, detail });
const unreadable = (detail: string): Denial => deny("unreadable", detail);

// A program the guard checks, named as a word of its own, in any case, after a path or as git-<command>.
const GUARDED = /(?:^|[^\w.-])(?:gh|git|curl)\b/i;
// Variables that choose the token, gh's or git's configuration, the home both read it from, or git's repository (A13).
const PROTECTED_NAMES =
  "GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|GITHUB_ENTERPRISE_TOKEN|GH_CONFIG_DIR|GH_HOST|SSH_ASKPASS|HOME|" +
  // Every git variable but the pager's and the prompt's: they choose its repository, configuration, editor or programs.
  "XDG_CONFIG_HOME|GIT_(?!(?:PAGER|TERMINAL_PROMPT)\\b)\\w+|" +
  // gh's repository, curl's configuration, and the editors and browsers gh runs.
  "GH_REPO|CURL_HOME|GH_EDITOR|GH_BROWSER|EDITOR|VISUAL|BROWSER";
const PROTECTED = new RegExp(`^(?:${PROTECTED_NAMES})$`);
const MENTIONED = new RegExp(`(?:^|\\W)(?:${PROTECTED_NAMES})(?:\\W|$)`);
const ASSIGNMENT = /^([A-Za-z_]\w*)(?:\[[^\]]*\])?\+?=/;
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "csh", "tcsh"]);
// Programs that run a command from their words or later, and shells the guard does not read.
const RUNNERS = new Set(["eval", "trap", "alias", "watch", "pwsh", "powershell"]);
// zsh's precommand modifiers.
const ZSH_ONLY = new Set(["noglob", "nocorrect", "-"]);
// find's actions that run a command.
const FIND_RUNS = /^-(?:exec|execdir|ok|okdir)$/;

interface Options {
  readonly flags: ReadonlySet<string>;
  readonly valued: ReadonlySet<string>;
}
const options = (spec: string): Options => {
  const [flags = new Set<string>(), valued = new Set<string>()] = spec
    .split("|")
    .map((list) => new Set(list.split(" ").filter(Boolean)));
  return { flags, valued };
};

// Words that run the command after them: their flags, then (after |) the options that take a value.
const WRAPPERS = new Map<string, Options>(
  Object.entries({
    command: "-p -v -V |",
    builtin: "|",
    exec: "-c -l | -a",
    nohup: "|",
    time: "-p -v -a -q --verbose --portability --append --quiet | -o -f --output --format",
    nice: "| -n --adjustment",
    timeout: "-v --verbose --preserve-status --foreground | -s -k --signal --kill-after",
    stdbuf: "| -i -o -e --input --output --error",
    setsid: "-c -f -w --ctty --fork --wait |",
    ionice: "-t --ignore | -c -n -p --class --classdata --pid",
    caffeinate: "-d -i -m -s -u | -t -w",
    env: "-i -0 -v - --ignore-environment --null --debug | -u -C --unset --chdir",
    xargs:
      "-0 -r -t -p -x -o --null --no-run-if-empty --verbose --interactive --exit --open-tty | -I -n -L -P -d -E -s " +
      "-a --max-args --max-procs --delimiter --arg-file --max-lines --max-chars --eof",
  }).map(([name, spec]) => [name, options(spec)]),
);
// Builtins that set a variable named by an argument.
const EXPORTS = new Set(["export", "declare", "typeset", "readonly", "local", "unset", "setenv"]);
const SETTERS = new Set([...EXPORTS, "read", "printf", "mapfile", "readarray"]);

const EMPTY: Word = { text: "", start: "" };
const known = (text: string): Word => ({ text, start: text });
// A program by the name it runs under: its file name, folded as APFS and Windows fold names (NFKC, lower case), no .exe.
const programOf = (word: string): string => {
  const name = word.normalize("NFKC");
  return name
    .slice(name.lastIndexOf("/") + 1)
    .toLowerCase()
    .replace(/\.exe$/, "");
};

/**
 * Whether the guard refuses the shell command `text`, run in the folder `folder`, and why; null to let it run. It reads
 * simple commands, pipelines, lists, quotes, `$(...)`, heredocs and if, for, while and until, and refuses every other
 * form (A79).
 */
export const guardCommand = (text: string, folder: string, policy: GuardPolicy, remotes: Remotes): Denial | null => {
  const script = readShell(text);
  if (script.skipped) return unreadable("the command holds a form the guard does not read, such as a subshell");
  const context = { policy, remotes, folders: foldersOf(script, [folder]) };
  for (const command of script.commands) {
    const denial = checkCommand(command, context);
    if (denial !== null) return denial;
  }
  return null;
};

const home = (path: string): string => path.replace(/^~(?=\/|$)/, homedir());

// Where a cd or pushd goes: its literal folder, the home folder without one, or null for one the guard cannot read.
const cdTarget = (args: readonly Word[]): string | null => {
  const target = args.find(({ start }) => !start.startsWith("-"));
  if (target === undefined) return homedir();
  return target.text === null ? null : home(target.text);
};

// The folders a command may run in: the session's, and each literal `cd` or `pushd` from each of them.
const foldersOf = (script: Script, starts: readonly string[]): string[] | null => {
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

interface Unwrapped {
  words: Word[];
  prefix: Word[];
  // xargs adds words it reads; env -i or exec -c clears the environment; env -u unsets variables; env -C runs the
  // command in another folder; an option the guard does not know may take the command word as its value.
  appended: boolean;
  cleared: boolean;
  unset: (Word | undefined)[];
  moved: boolean;
  unknown: string | null;
}

// The command's own words: assignments, reserved words and wrappers skipped, with the words before them (`prefix`).
const unwrap = (words: readonly Word[]): Unwrapped => {
  const found: Unwrapped = {
    words: [],
    prefix: [],
    appended: false,
    cleared: false,
    unset: [],
    moved: false,
    unknown: null,
  };
  let i = 0;
  while (i < words.length && found.unknown === null) {
    const { text, start } = words[i] ?? EMPTY;
    const name = programOf(text ?? "");
    const spec = WRAPPERS.get(name);
    if (ASSIGNMENT.test(start) || RESERVED.has(text ?? "")) i += 1;
    else if (spec === undefined) break;
    else i = wrapper(name, words, i + 1, { spec, found });
  }
  return { ...found, words: words.slice(i), prefix: words.slice(0, i) };
};

// An option of a wrapper, and its value when it takes one: attached, or the next word (`next`).
interface Option {
  readonly name: string;
  readonly value?: Word | undefined;
  readonly next?: boolean;
}

// The options an option word holds: a flag, an option that takes the next word, a long option with its =value, or a
// cluster of short flags; null for one the guard does not know.
const optionsOf = ({ text: option }: Word, next: Word | undefined, spec: Options): Option[] | null => {
  if (option === null) return null;
  if (spec.flags.has(option)) return [{ name: option }];
  if (spec.valued.has(option)) return [{ name: option, value: next, next: true }];
  if (/^--[^=]+=/.test(option)) return longOption(option, spec);
  return /^-[^-]/.test(option) ? cluster(option, next, spec) : null;
};

const longOption = (option: string, spec: Options): Option[] | null => {
  const name = option.slice(0, option.indexOf("="));
  const value = known(option.slice(name.length + 1));
  return spec.valued.has(name) || spec.flags.has(name) ? [{ name, value }] : null;
};

// Short flags in one word; the first that takes a value takes the rest of the word, or the next word at its end.
const cluster = (option: string, next: Word | undefined, spec: Options): Option[] | null => {
  const found: Option[] = [];
  for (let k = 1; k < option.length; k += 1) {
    const name = `-${option.charAt(k)}`;
    const rest = option.slice(k + 1);
    if (spec.valued.has(name))
      return [...found, rest === "" ? { name, value: next, next: true } : { name, value: known(rest) }];
    if (!spec.flags.has(name)) return null;
    found.push({ name });
  }
  return found;
};

// A wrapper's options from `from` on, noted in `found`; the index of the word after them.
const wrapper = (
  name: string,
  words: readonly Word[],
  from: number,
  read: { spec: Options; found: Unwrapped },
): number => {
  const i = wrapperOptions(name, words, from, read);
  read.found.appended ||= name === "xargs";
  // timeout's duration comes before its command; `--` ends the options.
  return i + Number(name === "timeout") + Number(words[i]?.text === "--");
};

// The index of the first word after the options; at an option the guard does not know, that word's, noted as unknown.
const wrapperOptions = (
  name: string,
  words: readonly Word[],
  from: number,
  { spec, found }: { spec: Options; found: Unwrapped },
): number => {
  let i = from;
  for (let word = words[i] ?? EMPTY; word.start.startsWith("-") && word.text !== "--"; word = words[++i] ?? EMPTY) {
    const parsed = optionsOf(word, words[i + 1], spec);
    if (parsed === null) {
      found.unknown = `${name} ${word.text ?? word.start}`;
      return i;
    }
    for (const option of parsed) noteOption(name, option, found);
    if (parsed.some((option) => option.next === true)) i += 1;
  }
  return i;
};

// What an option of env or exec does: clearing the environment (env -i, exec -c), unsetting a variable (env -u) or
// moving to another folder (env -C).
const noteOption = (wrapperName: string, { name, value }: Option, found: Unwrapped): void => {
  if (wrapperName === "exec" && name === "-c") found.cleared = true;
  if (wrapperName !== "env") return;
  if (/^(?:-i|-|--ignore-environment)$/.test(name)) found.cleared = true;
  if (name === "-u" || name === "--unset") found.unset.push(value);
  if (name === "-C" || name === "--chdir") found.moved = true;
};

const checkPrefix = ({ prefix, cleared, unset, unknown }: Unwrapped): Denial | null => {
  if (unknown !== null) return unreadable(`${unknown} is an option the guard does not know`);
  if (unset.some((word) => (word?.text ?? null) === null))
    return unreadable("env -u names a variable the guard cannot read");
  const names = [
    ...prefix.map((word) => ASSIGNMENT.exec(word.start)?.[1] ?? ""),
    ...unset.map((word) => word?.text ?? ""),
  ];
  const changed = names.find((name) => PROTECTED.test(name));
  if (changed !== undefined) return deny("environment", `it changes ${changed}`);
  return cleared ? deny("environment", "it clears the environment, the token with it") : null;
};

// Programs that run their arguments, which xargs would hand words the guard cannot read.
const runsArguments = (name: string): boolean =>
  GUARDED.test(` ${name} `) ||
  [SHELLS, WRAPPERS, FORBIDDEN, RUNNERS, ZSH_ONLY].some((set) => set.has(name)) ||
  /^(?:source|\.|find)$/.test(name);

const XARGS = unreadable("xargs adds words the guard cannot read to a program that runs them");

const checkCommand = ({ words }: Command, context: Context): Denial | null => {
  const unwrapped = unwrap(words);
  const denial = checkPrefix(unwrapped);
  if (denial !== null) return denial;
  const [first, ...args] = unwrapped.words;
  if (first === undefined) return unwrapped.appended ? XARGS : null;
  if (first.text === null) return unreadable("it runs a command whose name the guard cannot read");
  const name = programOf(first.text);
  // zsh runs `=name` as the program's path, and its precommand modifiers as wrappers.
  if (first.text.startsWith("=") || ZSH_ONLY.has(name))
    return unreadable(`${first.text} is a zsh form the guard does not read`);
  if (unwrapped.appended && runsArguments(name)) return XARGS;
  return checkProgram(name, args, unwrapped.moved ? { ...context, folders: null } : context);
};

const checkProgram = (name: string, args: readonly Word[], context: Context): Denial | null => {
  if (name === "git") return checkGit(args, context);
  if (name === "gh") return checkGh(args, context);
  if (name === "curl") return checkCurl(args, context);
  if (name.startsWith("git-")) return checkGit([{ text: name.slice(4), start: name.slice(4) }, ...args], context);
  if (SETTERS.has(name)) return checkSetter(name, args);
  if (RUNNERS.has(name)) return unreadable(`${name} runs a command the guard does not read`);
  if (SHELLS.has(name) || name === "source" || name === ".") return checkShell(name, args);
  if (name === "find" && args.some(({ text }) => FIND_RUNS.test(text ?? ""))) {
    return unreadable("find runs a command the guard does not read");
  }
  return forbiddenProgram(name, args);
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

// The words that name variables: printf's -v value, read's words but its options' values, an export's words.
const variableWords = (name: string, args: readonly Word[]): Word[] => {
  if (name === "printf") return args.filter((_, i) => args[i - 1]?.text === "-v");
  if (name !== "read") return args.filter(({ start }) => !start.startsWith("-"));
  return args.filter(({ start }, i) => !start.startsWith("-") && !/^-\w*[dinNptu]$/.test(args[i - 1]?.start ?? ""));
};

// export, read, printf -v and the like: naming a protected variable refuses, as does a name the guard cannot read.
const checkSetter = (name: string, args: readonly Word[]): Denial | null => {
  const names = variableWords(name, args);
  if (names.some(({ start }) => MENTIONED.test(start)))
    return deny("environment", `${name} names a protected variable`);
  const unknown = names.some(({ text, start }) => text === null && !start.includes("="));
  return unknown ? unreadable(`${name} names a variable the guard cannot read`) : null;
};

// What a shell option does: makes the shell read its script from stdin (-s, `-`) or from a word (-c, fish's -C), takes
// the next word (-o and the like), or nothing; null for a word that is no option.
const shellOption = (name: string, text: string): "value" | "stdin" | "command" | "flag" | null => {
  if (/^-(?:[A-Za-z]*s[A-Za-z]*)?$/.test(text)) return "stdin";
  if (
    /^--(?:command|init-command)(?:=|$)/.test(text) ||
    (name === "fish" ? /^-[A-Za-z]*[cC]/ : /^-[A-Za-z]*c/).test(text)
  ) {
    return "command";
  }
  if (/^(?:[-+][A-Za-z]*[oO]|--rcfile|--init-file)$/.test(text)) return "value";
  return /^(?:[-+][A-Za-z]+|--.*)$/.test(text) ? "flag" : null;
};

// Whether a shell runs a script file: the first word after its options, with no -c or -s before it.
const runsFile = (name: string, args: readonly Word[]): boolean => {
  for (let i = 0; i < args.length; i += 1) {
    const text = args[i]?.text ?? null;
    const option = text === null ? "stdin" : shellOption(name, text);
    if (option === null) return !/^\/(?:dev\/(?:stdin|fd\/)|proc\/self\/fd\/)/.test(text ?? "");
    if (option === "stdin" || option === "command") return false;
    if (option === "value") i += 1;
  }
  return false;
};

// A shell or source runs a script file, which the guard does not read; a script from -c, a pipe, a heredoc or a word it
// cannot read refuses.
const checkShell = (name: string, args: readonly Word[]): Denial | null => {
  const file = name === "source" || name === "." ? runsFile(name, args.slice(0, 1)) : runsFile(name, args);
  return file ? null : unreadable(`${name} runs a script the guard does not read`);
};

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

// A command's options, read as pflag and curl read them anywhere among its words, and its other words; null for an
// option the guard does not know, which may take a word as its value.
const interleaved = (args: readonly Word[], spec: Options): { options: Option[]; positionals: Word[] } | null => {
  const options: Option[] = [];
  const positionals: Word[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const word = args[i] ?? EMPTY;
    if (word.text === "--") return { options, positionals: [...positionals, ...args.slice(i + 1)] };
    const parsed = word.start.startsWith("-") && word.start !== "-" ? optionsOf(word, args[i + 1], spec) : [];
    if (parsed === null) return null;
    if (parsed.length === 0) positionals.push(word);
    options.push(...parsed);
    if (parsed.some(({ next }) => next === true)) i += 1;
  }
  return { options, positionals };
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
    : deny("outside-profiles", `${what} reaches ${outside ?? "a repository it cannot tell"}, outside this session's`);
};

// Issues are worked on in the hub only (A3): a call on issues of any other repository, or of one the guard cannot tell.
const checkHub = (repos: readonly (string | null)[] | null, context: Context, what: string): Denial | null => {
  const { hub } = context.policy;
  const elsewhere = repos === null || hub === null || repos.some((repo) => !sameRepo(repo, hub));
  return elsewhere ? deny("issue-outside-hub", `${what} works on issues outside the hub`) : null;
};

// gh's options that take the next word as a value in every command that has them, so a value is no positional.
const GH_VALUED = new Set(
  (
    "-R --repo --hostname -q --jq -t --template --json -b --body -F --body-file -T --title -l --label -B --base --head " +
    "--assignee --reviewer -m --milestone -p --project -L --limit -s --state -A --author -S --search -w --workflow " +
    "--branch -e --env -o --org -u --user"
  ).split(" "),
);
// gh's own aliases of its verbs.
const GH_ALIASES = new Map([
  ["new", "create"],
  ["ls", "list"],
  ["rm", "delete"],
  ["remove", "delete"],
]);
// Groups gh runs without a verb, or whose next word is no verb the guard checks.
const GH_SINGLE = new Set(["browse", "status", "help", "version", "completion", "search"]);
// A login or configuration change of gh itself, and the writes the owner keeps (secrets, repositories and their
// settings, releases, anything public; A13).
const GH_CONFIG =
  /^(?:auth (?!status$)\S+|config (?:set|clear-cache)|alias (?!list$)\S+|extension (?!list$|search$|browse$)\S+|(?:ssh|gpg)-key (?!list$)\S+)$/;
const GH_OWNER =
  /^(?:(?:secret|variable) (?!list$|get$)\S+|repo (?!view$|clone$|list$)\S+|release (?!list$|view$|download$)\S+|gist (?!list$|view$)\S+|codespace \S+|ruleset (?!list$|view$|check$)\S+)$/;
// Commands that work on no repository and write nothing.
const GH_FREE =
  /^(?:search|status|help|version|completion|org list|project (?:list|view)|auth status|config (?:get|list)|alias list|extension (?:list|search|browse)|gist (?:list|view)|(?:ssh|gpg)-key list|repo list)$/;
// Commands on one repository the guard lets run there: reads, and the writes of everyday work.
const GH_REPO_COMMANDS = new Set(
  (
    "issue list|issue view|issue status|issue create|issue comment|issue edit|issue close|issue reopen|issue lock|" +
    "issue unlock|issue pin|issue unpin|pr list|pr view|pr status|pr create|pr checkout|pr diff|pr checks|pr comment|" +
    "pr edit|pr close|pr reopen|pr ready|pr review|pr update-branch|repo view|repo clone|run list|run view|run watch|" +
    "run rerun|run cancel|run download|workflow list|workflow view|workflow run|release list|release view|" +
    "release download|label list|label create|label edit|cache list|browse|secret list|variable list|variable get|" +
    "ruleset list|ruleset view|ruleset check"
  ).split("|"),
);

// gh's command: its group and, for a group with verbs, the verb with gh's aliases resolved; null when the guard cannot
// read it, or when a flag other than -R comes before the verb and may take it as its value.
const ghCommand = (args: readonly Word[]): { group: string; command: string; rest: Word[] } | null => {
  const group = args[0]?.text;
  if (group === "--version") return { group: "version", command: "version", rest: [] };
  if (typeof group !== "string" || group.startsWith("-")) return null;
  if (GH_SINGLE.has(group)) return { group, command: group, rest: args.slice(1) };
  let i = 1;
  while (/^(?:-R|--repo)(?:=|$)|^-R./.test(args[i]?.start ?? ""))
    i += /^(?:-R|--repo)$/.test(args[i]?.text ?? "") ? 2 : 1;
  const verb = args[i]?.text;
  if (typeof verb !== "string" || verb.startsWith("-")) return null;
  return {
    group,
    command: `${group} ${GH_ALIASES.get(verb) ?? verb}`,
    rest: [...args.slice(1, i), ...args.slice(i + 1)],
  };
};

const checkGh = (args: readonly Word[], context: Context): Denial | null => {
  if (args[0]?.text === "api") return checkGhApi(args.slice(1), context);
  const read = ghCommand(args);
  if (read === null) return unreadable("gh runs a command the guard cannot read");
  const { group, command, rest } = read;
  return ghRule(command, rest) ?? ghTargets(group, command, rest, context);
};

// What the guard refuses in gh whatever the repository.
const ghRule = (command: string, rest: readonly Word[]): Denial | null => {
  if (GH_CONFIG.test(command)) return deny("gh-config", `gh ${command}`);
  if (GH_OWNER.test(command)) return deny("forbidden", `gh ${command}, which the owner keeps`);
  if (command === "pr merge") return deny("merge", "gh pr merge");
  return command === "pr review" && approves(rest) ? deny("approval", "gh pr review --approve") : null;
};

// The repository a gh command works on, and the hub for issue commands; a command the guard does not know refuses.
const ghTargets = (group: string, command: string, rest: readonly Word[], context: Context): Denial | null => {
  if (GH_FREE.test(command)) return null;
  if (!GH_REPO_COMMANDS.has(command)) return unreadable(`gh ${command} is a gh command the guard does not know`);
  const repos = ghRepos(command, rest, context);
  return (
    checkRepos(repos, context, `gh ${command}`) ??
    (group === "issue" ? checkHub(repos, context, `gh ${command}`) : null)
  );
};

// gh pr review approves with --approve or -a, alone or in a cluster.
const approves = (rest: readonly Word[]): boolean =>
  rest.some(({ text, start }) =>
    text === null ? /^-[^-]/.test(start) : text === "--approve" || /^-[^-]*a/.test(text),
  );

// The value of a -R or --repo word: attached, or the next word; null when unknown, undefined for another word. -R after
// other flags in a cluster is unknown too.
const repoValue = ({ text, start }: Word, next: Word | undefined): string | null | undefined => {
  if (/^-[^-]+R/.test(start)) return null;
  if (!/^(?:-R|--repo(?:=|$))/.test(start)) return undefined;
  if (text === "-R" || text === "--repo") return next?.text ?? null;
  return text?.replace(/^(?:-R|--repo=)/, "") ?? null;
};

// The repositories a gh command reaches, all of them checked: each -R or --repo, the repository `gh repo view|clone`
// names, each github.com URL among its positionals; else those of the remotes where it runs.
const ghRepos = (command: string, rest: readonly Word[], context: Context): (string | null)[] | null => {
  const options = rest.flatMap((word, i) => {
    const value = repoValue(word, rest[i + 1]);
    return value === undefined ? [] : [value];
  });
  const positional = rest.filter(({ start }, i) => !start.startsWith("-") && !GH_VALUED.has(rest[i - 1]?.start ?? ""));
  const named = /^repo (?:view|clone)$/.test(command)
    ? positional.slice(0, 1).map(({ text }) => text)
    : positional.flatMap(({ text }) =>
        text !== null && /^https?:\/\/(?:www\.)?github\.com\//i.test(text) ? [text] : [],
      );
  const repos = [...options, ...named].map((text) => (text === null ? null : ghRepo(text)));
  return repos.length === 0 ? implicitRepos(context) : repos;
};

const GH_API = options(
  "-i --include --paginate --silent --slurp --verbose | -X --method -f --raw-field -F --field -H --header --input -q " +
    "--jq -t --template --hostname --cache -p --preview",
);

// What a gh api call sends: its method, its fields by name (null for a value read from a file), and whether a field or
// body the guard cannot read may hide one.
interface ApiCall {
  readonly method: string;
  readonly fields: ReadonlyMap<string, string | null>;
  readonly hidden: boolean;
}

// A field of gh api: false when the guard cannot read its name.
const addField = (fields: Map<string, string | null>, { name, value }: Option): boolean => {
  const text = value?.text ?? null;
  if (text === null || !text.includes("=")) return false;
  const [key = "", ...parts] = text.split("=");
  const field = parts.join("=");
  fields.set(key, (name === "-F" || name === "--field") && field.startsWith("@") ? null : field);
  return true;
};

// gh api's method (the last -X, else POST when it sends a body, else GET), fields and host; null when the guard cannot
// read the method, or the host is not github.com.
const apiCall = (options: readonly Option[]): ApiCall | null => {
  const fields = new Map<string, string | null>();
  let hidden = false;
  for (const option of options) {
    if (/^(?:-f|-F|--field|--raw-field)$/.test(option.name)) hidden ||= !addField(fields, option);
    hidden ||= option.name === "--input";
    if (option.name === "--hostname" && option.value?.text !== "github.com") return null;
  }
  const method = options.findLast(({ name }) => name === "-X" || name === "--method");
  if (method !== undefined) {
    const text = method.value?.text?.toUpperCase();
    return text === undefined ? null : { method: text, fields, hidden };
  }
  return { method: fields.size > 0 || hidden ? "POST" : "GET", fields, hidden };
};

const checkGhApi = (rest: readonly Word[], context: Context): Denial | null => {
  const read = interleaved(rest, GH_API);
  const call = read === null ? null : apiCall(read.options);
  const [endpoint, ...more] = read?.positionals ?? [];
  if (call === null || typeof endpoint?.text !== "string" || more.length > 0) {
    return unreadable("gh api calls an endpoint, method or host the guard cannot read");
  }
  if (endpoint.text === "graphql") return checkGraphql(call, context);
  const event = call.hidden ? null : (call.fields.get("event") ?? (call.fields.has("event") ? null : ""));
  return checkApiPath(call.method, endpoint.text, event, context);
};

// An endpoint's path as GitHub routes it: resolved against api.github.com (dot segments gone), percent-decoded and in
// lower case; null for another host or a path the guard cannot decode.
const apiPath = (endpoint: string): string | null => {
  try {
    const url = new URL(
      /^https?:\/\//i.test(endpoint) ? endpoint : `/${endpoint.replace(/^\//, "")}`,
      "https://api.github.com",
    );
    return /^(?:api|uploads)\.github\.com$/i.test(url.hostname) ? decodeURIComponent(url.pathname).toLowerCase() : null;
  } catch {
    return null;
  }
};

// gh fills {owner} and :owner, {repo} and :repo from the repository where it runs.
const placeholder = (part: string, which: string): boolean => part === `{${which}}` || part === `:${which}`;

// The repositories owner/name names, each placeholder filled from the remotes where the call runs.
const filled = (owner: string, name: string, context: Context): (string | null)[] | null => {
  if (!placeholder(owner, "owner") && !placeholder(name, "repo")) return [ghRepo(`${owner}/${name}`)];
  const implicit = implicitRepos(context);
  return (
    implicit?.map((repo) => {
      const [own = "", repoName = ""] = repo?.split("/") ?? [];
      const full = `${placeholder(owner, "owner") ? own : owner}/${placeholder(name, "repo") ? repoName : name}`;
      return repo === null ? null : ghRepo(full);
    }) ?? null
  );
};

// A REST call on GitHub's API, from gh api or curl: the repository it reaches, issues on the hub only, no merge, no
// approving review (`event`: the review's event, null when the guard cannot read it), and of the writes only those of
// everyday work.
const checkApiPath = (method: string, endpoint: string, event: string | null, context: Context): Denial | null => {
  const what = `${method} ${endpoint}`;
  const path = apiPath(endpoint);
  if (path === null || path.startsWith("/repositories/"))
    return unreadable(`${what} reaches what the guard cannot tell`);
  const match = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(path);
  if (match === null) return method === "GET" ? null : unreadable(`${what} is a GitHub write the guard does not know`);
  const [, owner = "", name = "", rest = ""] = match;
  const repos = filled(owner, name, context);
  return checkRepos(repos, context, what) ?? checkRestPath(method, rest, { repos, event, what }, context);
};

// The writes a session may make in a repository: pull requests, their comments, reviews and reviewers, and runs.
const WRITES = [
  "POST /pulls",
  "PATCH /pulls/\\d+",
  "POST /pulls/\\d+/(?:comments|reviews|requested_reviewers)",
  "DELETE /pulls/\\d+/requested_reviewers",
  "POST /pulls/\\d+/comments/\\d+/replies",
  "POST /pulls/\\d+/reviews/\\d+/events",
  "PUT /pulls/\\d+/update-branch",
  "(?:PATCH|DELETE) /pulls/comments/\\d+",
  "POST /actions/runs/\\d+/(?:rerun|rerun-failed-jobs|cancel)",
  "POST /actions/workflows/[^/]+/dispatches",
].map((write) => new RegExp(`^${write}/?$`));

const merges = (method: string, rest: string): boolean =>
  (method === "PUT" && /^\/pulls\/[^/]+\/merge\/?$/.test(rest)) || (method === "POST" && /^\/merges\/?$/.test(rest));

// A review created or submitted with APPROVE, or with an event the guard cannot read.
const approvesReview = (method: string, rest: string, event: string | null): boolean =>
  method === "POST" &&
  /^\/pulls\/[^/]+\/reviews(?:\/[^/]+\/events)?\/?$/.test(rest) &&
  (event === null || /^approve$/i.test(event));

const checkRestPath = (
  method: string,
  rest: string,
  { repos, event, what }: { repos: (string | null)[] | null; event: string | null; what: string },
  context: Context,
): Denial | null => {
  if (/^\/issues(?:\/|$)/.test(rest)) return checkHub(repos, context, what);
  if (method === "GET" || method === "HEAD") return null;
  if (merges(method, rest)) return deny("merge", what);
  if (approvesReview(method, rest, event)) return deny("approval", what);
  return WRITES.some((write) => write.test(`${method} ${rest}`))
    ? null
    : unreadable(`${what} is a GitHub write the guard does not know`);
};

// The GraphQL mutations a session may send: replies to review threads and their resolution.
const GRAPHQL_WRITES = new Set(["resolveReviewThread", "unresolveReviewThread", "addPullRequestReviewThreadReply"]);

// gh api graphql: a merge or a review refuses, as does any other mutation the guard does not know, and any document while
// the session is limited to repositories, as the guard cannot tell what a document reaches.
const checkGraphql = ({ fields, hidden }: ApiCall, context: Context): Denial | null => {
  const query = fields.get("query");
  if (hidden || typeof query !== "string") return unreadable("gh api graphql sends a document the guard cannot read");
  if (/\b(?:mergePullRequest|enablePullRequestAutoMerge|mergeBranch|enqueuePullRequest)\b/.test(query)) {
    return deny("merge", "a merge through GraphQL");
  }
  if (/\b(?:addPullRequestReview|submitPullRequestReview)\b/.test(query)) {
    return deny("approval", "a review through GraphQL, which may approve");
  }
  const body = query.replace(/\bmutation\b\s*\w*\s*(?:\([^)]*\))?/, "");
  if (body !== query && [...body.matchAll(/(\w+)\s*\(/g)].some(([, name = ""]) => !GRAPHQL_WRITES.has(name))) {
    return unreadable("gh api graphql sends a mutation the guard does not know");
  }
  return context.policy.repositories === null
    ? null
    : unreadable("gh api graphql reaches repositories the guard cannot tell");
};

const CURL = options(
  "-s --silent -S --show-error -f --fail --fail-with-body -L --location -i --include -I --head -v --verbose -k " +
    "--insecure -g --globoff --compressed -N --no-buffer -G --get -O --remote-name -J --remote-header-name " +
    "--create-dirs -# --progress-bar --http1.1 --http2 | -X --request -H --header -d --data --data-raw --data-binary " +
    "--data-urlencode --data-ascii -F --form --form-string --json -T --upload-file -o --output --output-dir -u --user " +
    "-A --user-agent -e --referer -b --cookie -c --cookie-jar -w --write-out -m --max-time --connect-timeout --retry " +
    "--retry-delay --retry-max-time --max-redirs -x --proxy --url -r --range --cacert --capath -E --cert --key",
);
const CURL_BODY = /^(?:-d|--data(?:-raw|-binary|-urlencode|-ascii)?|-F|--form|--form-string|--json)$/;

// curl's method: the last -X, else PUT for an upload, HEAD for -I, GET for -G or no body, else POST; null when unknown.
const curlMethod = (options: readonly Option[]): string | null => {
  const has = (pattern: RegExp) => options.some(({ name }) => pattern.test(name));
  const request = options.findLast(({ name }) => name === "-X" || name === "--request");
  if (request !== undefined) return request.value?.text?.toUpperCase() ?? null;
  if (has(/^(?:-T|--upload-file)$/)) return "PUT";
  if (has(/^(?:-I|--head)$/)) return "HEAD";
  return has(/^(?:-G|--get)$/) || !has(CURL_BODY) ? "GET" : "POST";
};

// curl to GitHub: each URL it reaches, checked as gh api or git would be; an option, URL or method it cannot read
// refuses, and so does a URL curl would expand as a glob.
const checkCurl = (args: readonly Word[], context: Context): Denial | null => {
  const read = interleaved(args, CURL);
  const method = read === null ? null : curlMethod(read.options);
  if (read === null || method === null) return unreadable("curl gets an option or method the guard cannot read");
  const globs = !read.options.some(({ name }) => name === "-g" || name === "--globoff");
  const urls = [
    ...read.positionals,
    ...read.options.flatMap(({ name, value }) => (name === "--url" ? [value ?? { text: null, start: "" }] : [])),
  ];
  if (urls.some(({ text }) => text === null || (globs && /[{}[\]]/.test(text)))) {
    return unreadable("curl reaches a URL the guard cannot read");
  }
  const event = read.options.some(({ name }) => CURL_BODY.test(name)) && method !== "GET" ? null : "";
  return urls.map(({ text }) => curlUrl(text ?? "", method, event, context)).find((denial) => denial !== null) ?? null;
};

const curlUrl = (url: string, method: string, event: string | null, context: Context): Denial | null => {
  let parsed: URL;
  try {
    parsed = new URL(/^[a-z][\w+.-]*:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    return unreadable(`curl reaches ${url}, which the guard cannot read`);
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "api.github.com" || host === "uploads.github.com")
    return checkApiPath(method, parsed.href, event, context);
  if (!/(?:^|\.)github(?:usercontent)?\.com$/.test(host)) return null;
  const [owner = "", name = ""] = parsed.pathname.split("/").filter(Boolean);
  return checkRepos([ghRepo(`${owner}/${name.replace(/\.git$/i, "")}`)], context, `curl ${host}`);
};
