import { type Command, RESERVED, readShell, type Word } from "./shell.ts";

/** Why the guard refuses a call. */
export type Rule = "unreadable" | "environment" | "forbidden";

export interface Denial {
  readonly rule: Rule;
  readonly detail: string;
}

const deny = (rule: Rule, detail: string): Denial => ({ rule, detail });
const unreadable = (detail: string): Denial => deny("unreadable", detail);

// A program the guard checks, named as a word of its own, in any case, after a path or as git-<command>.
const GUARDED = /(?:^|[^\w.-])(?:gh|git|curl)\b/i;
// Variables that choose the token, gh's or git's configuration, the home both read it from, or git's repository (A13).
const PROTECTED_NAMES =
  "GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|GITHUB_ENTERPRISE_TOKEN|GH_CONFIG_DIR|GH_HOST|GIT_CONFIG\\w*|GIT_DIR|" +
  "GIT_WORK_TREE|GIT_SSH|GIT_SSH_COMMAND|GIT_ASKPASS|SSH_ASKPASS|HOME|XDG_CONFIG_HOME|" +
  // The tables of programs, aliases and functions bash and zsh look a command name up in.
  "BASH_CMDS|BASH_ALIASES|commands|aliases|galiases|saliases|functions";
const PROTECTED = new RegExp(`^(?:${PROTECTED_NAMES})$`);
const MENTIONED = new RegExp(`(?:^|\\W)(?:${PROTECTED_NAMES})(?:\\W|$)`);
const ASSIGNMENT = /^([A-Za-z_]\w*)(?:\[[^\]]*\])?\+?=/;
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "csh", "tcsh"]);
// Programs that run a command from their words or later, and shells the guard does not read.
const RUNNERS = new Set([
  "eval",
  "trap",
  "alias",
  "hash",
  "emulate",
  "compgen",
  "complete",
  "let",
  "watch",
  "pwsh",
  "powershell",
]);
// A subscript holding a command, which bash runs as arithmetic in let, read, printf -v, declare -i and [[ ]].
const CODE_SUBSCRIPT = /\[[^\]]*(?:\$\(|`)/;
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
// A program by the name it runs under: its file name, folded as APFS and Windows fold it (NFKC, lower case), no .exe.
const programOf = (word: string): string => {
  const name = word.normalize("NFKC");
  return name
    .slice(name.lastIndexOf("/") + 1)
    .toLowerCase()
    .replace(/\.exe$/, "");
};

/** Whether the guard refuses the shell command `text`, and why; null to let it run. */
export const guardCommand = (text: string): Denial | null => {
  const script = readShell(text);
  if (script.skipped) return unreadable("the command holds a form the guard does not read, such as a subshell");
  if (script.commands.some(({ words }) => words.some((word) => CODE_SUBSCRIPT.test(word.text ?? word.start)))) {
    return unreadable("a subscript holds a command, which bash may run");
  }
  for (const command of script.commands) {
    const denial = checkCommand(command);
    if (denial !== null) return denial;
  }
  return null;
};

// What a command's wrappers do to it.
interface Found {
  appended: boolean;
  lookup: boolean;
  cleared: boolean;
  unset: (Word | undefined)[];
  unknown: string | null;
}
interface Unwrapped extends Found {
  words: Word[];
  prefix: Word[];
}

// The command's own words: assignments, reserved words and wrappers skipped, with the words before them (`prefix`).
const unwrap = (words: readonly Word[]): Unwrapped => {
  const found: Found = { appended: false, lookup: false, cleared: false, unset: [], unknown: null };
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
const wrapperOptions = (
  name: string,
  words: readonly Word[],
  from: number,
  { spec, found }: { spec: Options; found: Found },
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

// env -i and exec -c clear the environment, env -u unsets a variable, command -v only looks a name up.
const noteOption = (wrapperName: string, { name, value }: Option, found: Found): void => {
  if (wrapperName === "exec" && name === "-c") found.cleared = true;
  if (wrapperName === "command" && (name === "-v" || name === "-V")) found.lookup = true;
  if (wrapperName !== "env") return;
  if (/^(?:-i|-|--ignore-environment)$/.test(name)) found.cleared = true;
  if (name === "-u" || name === "--unset") found.unset.push(value);
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

const checkCommand = ({ words }: Command): Denial | null => {
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
  return checkProgram(name, args);
};

const checkProgram = (name: string, args: readonly Word[]): Denial | null => {
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

// [[ ]] reads the operands of -eq and the like as arithmetic, subscripts and all: only a number or a plain $name, whose
// value the guard does not know, may stand there.
const ARITHMETIC = /^-(?:eq|ne|lt|le|gt|ge)$/;
const checkTest = (args: readonly Word[]): Denial | null => {
  const operands = args.filter(
    (_, i) => ARITHMETIC.test(args[i - 1]?.text ?? "") || ARITHMETIC.test(args[i + 1]?.text ?? ""),
  );
  const code = operands.some(({ text, plain }) => plain !== true && !/^-?\d+$/.test(text ?? ""));
  return code ? unreadable("[[ ]] compares a word as arithmetic, which bash may run") : null;
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

// A shell or source may run a script file, which the guard does not read; any other script refuses.
const checkShell = (name: string, args: readonly Word[]): Denial | null => {
  const file = name === "source" || name === "." ? runsFile(name, args.slice(0, 1)) : runsFile(name, args);
  return file ? null : unreadable(`${name} runs a script the guard does not read`);
};
