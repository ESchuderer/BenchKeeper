import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { type GuardPolicy, RepoName } from "@cedarloom/contracts";
import { type Command, RESERVED, readShell, type Script, type Word } from "./shell.ts";

/** Why the guard refuses a call. */
export type Rule = "unreadable" | "environment" | "git-config" | "forbidden" | "outside-profiles" | "memory-main";

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
  "XDG_CONFIG_HOME|GIT_(?!(?:PAGER|TERMINAL_PROMPT)\\b)\\w+|EDITOR|VISUAL|CDPATH|" +
  // The tables of programs, aliases and functions bash and zsh look a command name up in.
  "BASH_CMDS|BASH_ALIASES|commands|aliases|galiases|saliases|functions";
const PROTECTED = new RegExp(`^(?:${PROTECTED_NAMES})$`);
const MENTIONED = new RegExp(`(?:^|\\W)(?:${PROTECTED_NAMES})(?:\\W|$)`);
const ASSIGNMENT = /^([A-Za-z_]\w*)(?:\[[^\]]*\])?\+?=/;
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "csh", "tcsh"]);
// Programs that run a command from their words or later, and shells the guard does not read.
const RUNNERS = new Set("eval trap alias hash emulate compgen complete let watch pwsh powershell".split(" "));
// A subscript holding a command, which bash runs as arithmetic in let, read, printf -v, declare -i and [[ ]].
const CODE_SUBSCRIPT = /\[[^[\]]*(?:\$\(|`)/;
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
    xargs: "-0 -r -t -p -x --null --no-run-if-empty --verbose | -I -n -L -P -d -E -s -a --max-args --arg-file",
  }).map(([name, spec]) => [name, options(spec)]),
);
// Builtins that set a variable named by an argument.
const EXPORTS = new Set(["export", "declare", "typeset", "readonly", "local", "unset", "setenv"]);
const SETTERS = new Set([...EXPORTS, "read", "printf", "mapfile", "readarray"]);

const EMPTY: Word = { text: "", start: "" };
const known = (text: string): Word => ({ text, start: text });
// A program by the name it runs under: its file name, folded as APFS and Windows fold it (NFKC, lower case), no .exe.
const programOf = (word: string): string => {
  const name = word.normalize("NFKC");
  return name
    .slice(name.lastIndexOf("/") + 1)
    .toLowerCase()
    .replace(/\.exe$/, "");
};

/** Whether the guard refuses the shell command `text`, run in the folder `folder`, and why; null to let it run. */
export const guardCommand = (text: string, folder: string, policy: GuardPolicy, remotes: Remotes): Denial | null => {
  const script = readShell(text);
  if (script.skipped) return unreadable("the command holds a form the guard does not read, such as a subshell");
  if (script.commands.some(({ words }) => words.some((word) => CODE_SUBSCRIPT.test(word.text ?? word.start)))) {
    return unreadable("a subscript holds a command, which bash may run");
  }
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

// What a command's wrappers do to it.
interface Found {
  appended: boolean;
  lookup: boolean;
  cleared: boolean;
  unset: (Word | undefined)[];
  // env -C runs the command in another folder.
  moved: boolean;
  unknown: string | null;
}
interface Unwrapped extends Found {
  words: Word[];
  prefix: Word[];
}

// The command's own words: assignments, reserved words and wrappers skipped, with the words before them (`prefix`).
const unwrap = (words: readonly Word[]): Unwrapped => {
  const found: Found = { appended: false, lookup: false, cleared: false, unset: [], moved: false, unknown: null };
  let i = 0;
  while (i < words.length && found.unknown === null && !found.lookup) {
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

// The options a word holds (a flag, a valued option, --name=value, a cluster); null for one the guard does not know.
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
const wrapper = (name: string, words: readonly Word[], from: number, read: { spec: Options; found: Found }): number => {
  const i = wrapperOptions(name, words, from, read);
  read.found.appended ||= name === "xargs";
  // timeout's duration comes before its command; `--` ends the options.
  return i + Number(name === "timeout") + Number(words[i]?.text === "--");
};

// The index of the first word after the options; at an option the guard does not know, that word's, noted as unknown.
const wrapperOptions = (name: string, words: readonly Word[], from: number, read: { spec: Options; found: Found }) => {
  const { spec, found } = read;
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

// exec -c clears the environment, command -v only looks a name up.
const noteOption = (wrapperName: string, option: Option, found: Found): void => {
  if (wrapperName === "exec" && option.name === "-c") found.cleared = true;
  if (wrapperName === "command" && /^-[vV]$/.test(option.name)) found.lookup = true;
  if (wrapperName === "env") noteEnv(option, found);
};

// env -i clears the environment, -u unsets a variable, -C moves the command to another folder.
const noteEnv = ({ name, value }: Option, found: Found): void => {
  if (/^(?:-i|-|--ignore-environment)$/.test(name)) found.cleared = true;
  if (name === "-u" || name === "--unset") found.unset.push(value);
  if (name === "-C" || name === "--chdir") found.moved = true;
};

const checkPrefix = ({ prefix, cleared, unset, unknown }: Unwrapped): Denial | null => {
  if (unknown !== null) return unreadable(`${unknown} is an option the guard does not know`);
  if (unset.some((word) => (word?.text ?? null) === null))
    return unreadable("env -u names a variable the guard cannot read");
  const names = [...prefix.map((w) => ASSIGNMENT.exec(w.start)?.[1] ?? ""), ...unset.map((w) => w?.text ?? "")];
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
  if (denial !== null || unwrapped.lookup) return denial;
  const [first, ...args] = unwrapped.words;
  if (first === undefined) return unwrapped.appended ? XARGS : null;
  if (first.text === null) return unreadable("it runs a command whose name the guard cannot read");
  const name = programOf(first.text);
  // zsh runs `=name` as the program's path, and its precommand modifiers as wrappers.
  if (first.text.startsWith("=") || ZSH_ONLY.has(name))
    return unreadable(`${first.text} is a zsh form the guard does not read`);
  if (unwrapped.appended && runsArguments(name)) return XARGS;
  return checkProgram(name, args, context, unwrapped.moved);
};

// `moved`: env -C runs the program in a folder the guard does not know.
const checkProgram = (name: string, args: readonly Word[], context: Context, moved: boolean): Denial | null => {
  const where = moved ? { ...context, folders: null } : context;
  if (name === "git") return checkGit(args, where);
  return name.startsWith("git-") ? checkGit([known(name.slice(4)), ...args], where) : checkLocal(name, args);
};

// Programs that reach no repository: setters, runners, shells, find and the forbidden ones.
const checkLocal = (name: string, args: readonly Word[]): Denial | null => {
  if (SETTERS.has(name)) return checkSetter(name, args);
  if (name === "[[") return checkTest(args);
  if (RUNNERS.has(name)) return unreadable(`${name} runs a command the guard does not read`);
  if (SHELLS.has(name) || name === "source" || name === ".") return checkShell(name, args);
  if (name === "find" && args.some(({ text }) => FIND_RUNS.test(text ?? ""))) {
    return unreadable("find runs a command the guard does not read");
  }
  return forbiddenProgram(name, args);
};

// Programs the project rules forbid, with the argument that makes them so: an apply, or any for a sudo-like.
const FORBIDDEN = new Map<string, string | null>([
  ..."sudo doas su pkexec run0".split(" ").map((name): [string, null] => [name, null]),
  ...["terraform", "kubectl"].map((name): [string, string] => [name, "apply"]),
  ["helm", "upgrade"],
]);

const forbiddenProgram = (name: string, args: readonly Word[]): Denial | null => {
  const verb = FORBIDDEN.get(name);
  if (verb === undefined) return null;
  if (verb === null) return deny("forbidden", name);
  return args.some(({ text }) => text === verb) ? deny("forbidden", `${name} ${verb}`) : null;
};

// [[ ]] reads the operands of -eq and the like as arithmetic, and -v's as a name with a subscript: only a number, a
// plain $name or a plain name, whose value the guard does not know, may stand there.
const ARITHMETIC = /^-(?:eq|ne|lt|le|gt|ge)$/;
const checkTest = (args: readonly Word[]): Denial | null => {
  const at = (i: number): string => args[i]?.text ?? "";
  const arithmetic = ({ text, plain }: Word, i: number): boolean => {
    if (at(i - 1) === "-v") return !/^[A-Za-z_]\w*$/.test(text ?? "");
    const compared = ARITHMETIC.test(at(i - 1)) || ARITHMETIC.test(at(i + 1));
    return compared && plain !== true && !/^-?\d+$/.test(text ?? "");
  };
  const code = args.some((word, i) => arithmetic(word, i));
  return code ? unreadable("[[ ]] reads a word as arithmetic, which bash may run") : null;
};

// The words that name variables: read's words but its options' values, an export's words; printf names none.
const variableWords = (name: string, args: readonly Word[]): Word[] => {
  if (name === "printf") return [];
  if (name !== "read") return args.filter(({ start }) => !start.startsWith("-"));
  return args.filter(({ start }, i) => !start.startsWith("-") && !/^-\w*[dinNptu]$/.test(args[i - 1]?.start ?? ""));
};

// printf -v, read into an array or by -v, declare -i (arithmetic), and mapfile's callback (-C), attached or apart.
const setsAside = (name: string, args: readonly Word[]): boolean => {
  const flags = args.filter(({ start }) => start.startsWith("-")).map(({ start }) => start);
  if (name === "printf") return flags.some((option) => option.startsWith("-v"));
  if (name === "read") return flags.some((option) => /^-[^-]*[aAv]/.test(option));
  if (EXPORTS.has(name)) return flags.some((option) => /^-[^-]*i/.test(option));
  return /^(?:mapfile|readarray)$/.test(name) && flags.some((option) => /^-[^-]*C/.test(option));
};

// A setter refuses on a protected or unknown name, or an array element, whose subscript bash may run; mapfile on -C.
const checkSetter = (name: string, args: readonly Word[]): Denial | null => {
  if (setsAside(name, args)) return unreadable(`${name} sets a variable or runs a command the guard does not follow`);
  const names = variableWords(name, args);
  if (names.some(({ start }) => MENTIONED.test(start)))
    return deny("environment", `${name} names a protected variable`);
  const unknown = names.some(
    ({ text, start }) => (text === null && !start.includes("=")) || (text ?? start).split("=")[0]?.includes("["),
  );
  return unknown ? unreadable(`${name} names a variable the guard cannot read`) : null;
};

// A shell option: the script from stdin (-s) or a word (-c, fish's -C), a value next (-o), or a flag; null for none.
const shellOption = (name: string, text: string): "value" | "stdin" | "command" | "flag" | null => {
  if (/^-(?:[A-Za-rt-z]*s[A-Za-z]*)?$/.test(text)) return "stdin";
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

// A shell or source may run a script file, which the guard does not read; any other script refuses.
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
  (
    "-p --paginate -P --no-pager --bare --no-replace-objects --literal-pathspecs --glob-pathspecs --noglob-pathspecs " +
    "--icase-pathspecs --no-optional-locks --no-lazy-fetch --no-advice -v --version -h --help --html-path --man-path " +
    "--info-path --exec-path"
  ).split(" "),
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
    "add stage am annotate apply archive bisect blame branch bundle cat-file check-attr check-ignore check-mailmap " +
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
  ["grep", ["--open-files-in-pager"]],
]);
// Options and commands with which git runs a command or program of its own choosing, which the guard does not read.
const RUNS: readonly ((sub: string, rest: readonly Word[]) => boolean)[] = [
  (sub, rest) => rest.some((word) => (RUNNER_OPTIONS.get(sub) ?? []).some((option) => abbreviates(word, option, 3))),
  (sub, rest) => ["rebase", "difftool", "mergetool"].includes(sub) && hasShortFlag(rest, "x", "", ""),
  (sub, rest) => ["clone", "ls-remote"].includes(sub) && hasShortFlag(rest, "u", "objc", ""),
  (sub, rest) => sub === "grep" && hasShortFlag(rest, "O", "efABCm", ""),
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
  /^[a-z][\w+.-]*:\/\//i.test(text) || /^(?:[^\s/@:]+@)?[^\s/@:.]+(?:\.[^\s/@:.]+)+:/.test(text);

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
  const name = path
    .split("/")
    .filter(Boolean)
    .join("/")
    .replace(/\.git$/i, "");
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
