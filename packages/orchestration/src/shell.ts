/**
 * A word as the shell passes it: its text when the guard can read all of it (null once an expansion makes it unknown),
 * and its literal start, which is all of it for a read word.
 */
export interface Word {
  readonly text: string | null;
  readonly start: string;
}

/** A simple command: its words, assignments first. */
export interface Command {
  readonly words: Word[];
}

/**
 * The simple commands a text runs, those inside command substitutions too. `skipped`: the text holds a form outside the
 * guard's grammar, which may hide a command (A79): a subshell, a `{ ...; }` group, a function, `case`, `select` or
 * `coproc`, a process substitution, backquotes, arithmetic holding a command, zsh's `(` after a word or `${(` flags, or
 * text it cannot split (an unclosed quote, substitution or heredoc).
 */
export interface Script {
  readonly commands: Command[];
  readonly skipped: boolean;
}

/** Reserved words before a command's own words: those of lists, if, while and until, whose commands the guard reads. */
export const RESERVED = new Set(["if", "then", "else", "elif", "fi", "do", "done", "while", "until", "!"]);
// Commands outside the grammar, by their first word after the reserved ones; zsh runs `repeat`'s body as a loop.
const OUTSIDE = new Set(["function", "case", "select", "coproc", "repeat"]);
const NAME = /^[A-Za-z_]\w*/;
const ASSIGNED = /^[A-Za-z_]\w*(?:\[[^\]]*\])?\+?=/;
const OPENERS = new Set(["(", "{", "'", '"']);
const REDIRECT = /^(?:&>>?|<<<|<<-|<<|<>|<&|>&|>>|>\||[<>])/;
// What ends a word outside quotes; a carriage return is no blank to the shell.
const BREAKS = " \t\n;&|()<>";

class Builder {
  text = "";
  start: string | null = null;
  quoted = false;
  // The characters outside quotes, where the shell expands globs and braces.
  bare = "";
  // An expansion outside quotes, whose result the shell splits into words of its own.
  split = false;
  add(text: string, bare = false): void {
    this.text += text;
    if (bare) this.bare += text;
  }
  // An expansion: the word's text is unknown from here on.
  expand(bare = false): void {
    this.start ??= this.text;
    this.split ||= bare;
  }
  word(): Word {
    // A glob or brace list may expand to any word, an option among them.
    if (this.start === null && expands(this.bare)) return { text: null, start: "" };
    if (this.start === null) return { text: this.text, start: this.text };
    // An assignment is not split, so its name stays known.
    return { text: null, start: this.split && !ASSIGNED.test(this.start) ? "" : this.start };
  }
}

// Pathname and brace expansion turn a word with *, ?, [...] or {a,b} or {a..b} outside quotes into other words.
const expands = (bare: string): boolean => {
  const brace = /\{([^}]*)\}/.exec(bare)?.[1];
  return /[*?]|\[[^\]]*\]/.test(bare) || (brace !== undefined && /,|\.\./.test(brace));
};

interface Heredoc {
  readonly delimiter: string;
  readonly quoted: boolean;
  readonly strip: boolean;
}

class Reader {
  readonly commands: Command[] = [];
  skipped = false;
  #i = 0;
  readonly #text: string;
  readonly #heredocs: Heredoc[] = [];

  constructor(text: string) {
    this.#text = text;
  }

  get done(): boolean {
    return this.#i >= this.#text.length;
  }

  /** Reads commands up to `closer` (the `)` of a command substitution) or the end. */
  script(closer: ")" | null): void {
    let command: Command = { words: [] };
    while (!this.done) {
      const c = this.#peek();
      if (c === closer) {
        this.#i += 1;
        this.#end(command);
        return;
      }
      if (this.#separate(c)) {
        this.#end(command);
        command = { words: [] };
      } else if (!this.#space(c)) this.#push(command);
    }
    this.#end(command);
    if (closer !== null) this.skipped = true;
  }

  /** Ends the reading: a heredoc whose body never came was skipped. */
  finish(): void {
    if (this.#heredocs.length > 0) this.skipped = true;
  }

  // Text outside the grammar: the whole text refuses, so the reader stops.
  #outside(): void {
    this.skipped = true;
    this.#i = this.#text.length;
  }

  // Digits right before a redirection name its file descriptor, as 2 in 2>&1, and are no word. A bare `{` or `}` opens
  // or closes a group, in zsh after a condition too.
  #push(command: Command): void {
    const built = this.#word();
    const word = built.word();
    if (!built.quoted && (word.text === "{" || word.text === "}")) this.#outside();
    if (!(/^\d+$/.test(word.text ?? "") && /^[<>]$/.test(this.#peek()))) command.words.push(word);
  }

  #peek(offset = 0): string {
    return this.#text.charAt(this.#i + offset);
  }

  #end(command: Command): void {
    if (command.words.length === 0) return;
    const first = command.words.find(({ text }) => !RESERVED.has(text ?? ""))?.text ?? "";
    const texts = command.words.map(({ text }) => text);
    // bash's `for x do` needs no `;` before `do`, and zsh's short `if [[ ... ]] cmd` none before its body: both hide it.
    if (OUTSIDE.has(first) || (first === "for" && texts.includes("do")) || texts.slice(0, -1).includes("]]")) {
      this.#outside();
    }
    this.commands.push(command);
  }

  // A character that ends the command: a newline (then its heredocs follow), `;`, `&` or `|`. A `)` with no `(` is a
  // case pattern's or a stray one.
  #separate(c: string): boolean {
    if (c === "\n") {
      this.#i += 1;
      this.#readHeredocs();
      return true;
    }
    if (c === ")") {
      this.#outside();
      return true;
    }
    if (c === "&" && this.#peek(1) === ">") return false;
    if (!";&|".includes(c)) return false;
    this.#i += this.#peek(1) === c || (c === "|" && this.#peek(1) === "&") ? 2 : 1;
    return true;
  }

  // Blanks, line continuations, comments and redirections: whatever is no word of the command. A `(` opens a subshell,
  // a function's parameters, a case pattern or a zsh glob qualifier, all outside the grammar. True when it took the
  // character.
  #space(c: string): boolean {
    if (this.#blank(c)) return true;
    if (c === "#") {
      while (!this.done && this.#peek() !== "\n") this.#i += 1;
      return true;
    }
    if (c === "(") this.#outside();
    else if (/^[<>]$/.test(c) || (c === "&" && this.#peek(1) === ">")) this.#redirect();
    else return false;
    return true;
  }

  // A blank or a line continuation, taken.
  #blank(c: string): boolean {
    const blank = c === " " || c === "\t" || (c === "\\" && this.#peek(1) === "\n");
    if (blank) this.#i += c === "\\" ? 2 : 1;
    return blank;
  }

  // A redirection: its target word is no argument, and a heredoc's body is read after the line ends. `<(` and `>(`
  // start a process substitution, outside the grammar.
  #redirect(): void {
    const op = REDIRECT.exec(this.#text.slice(this.#i, this.#i + 3))?.[0] ?? "<";
    if (/^[<>]$/.test(op) && this.#peek(1) === "(") {
      this.#outside();
      return;
    }
    this.#i += op.length;
    while (this.#peek() === " " || this.#peek() === "\t") this.#i += 1;
    const target = this.#word();
    if (op === "<<" || op === "<<-") this.#heredoc(target, op === "<<-");
  }

  #heredoc(target: Builder, strip: boolean): void {
    const delimiter = target.word().text;
    if (delimiter === null || delimiter === "") this.skipped = true;
    else this.#heredocs.push({ delimiter, quoted: target.quoted, strip });
  }

  // Heredoc bodies after a newline: one under an unquoted delimiter is read as in double quotes, its substitutions run.
  #readHeredocs(): void {
    for (const doc of this.#heredocs.splice(0)) {
      const lines = this.#heredocLines(doc);
      if (!doc.quoted) this.#body(lines.join("\n"));
    }
  }

  // A heredoc's body lines up to its delimiter; one never closed, or a line bash may take as its end, was skipped.
  #heredocLines(doc: Heredoc): string[] {
    const lines: string[] = [];
    while (!this.done) {
      const end = this.#text.indexOf("\n", this.#i);
      const line = this.#text.slice(this.#i, end < 0 ? undefined : end);
      this.#i = end < 0 ? this.#text.length : end + 1;
      const text = doc.strip ? line.replace(/^\t+/, "") : line;
      if (text === doc.delimiter) return lines;
      // Inside `$(...)` bash may end the body at a line that only starts with the delimiter, such as `EOF)`.
      if (text.startsWith(doc.delimiter)) this.skipped = true;
      lines.push(line);
    }
    this.skipped = true;
    return lines;
  }

  #body(body: string): void {
    const reader = new Reader(body);
    reader.#doubleQuoted(new Builder(), null);
    this.#adopt(reader);
  }

  #adopt(script: Script): void {
    this.commands.push(...script.commands);
    this.skipped ||= script.skipped;
  }

  // One word, up to a blank or an operator; at least one character, so a reader always moves on.
  #word(): Builder {
    const word = new Builder();
    if (BREAKS.includes(this.#peek())) word.add(this.#text.charAt(this.#i++));
    while (!this.done && !BREAKS.includes(this.#peek())) {
      const c = this.#peek();
      this.#i += 1;
      if (c === "'") this.#singleQuoted(word);
      else if (c === '"') this.#doubleQuoted(word, '"');
      else if (c === "\\") this.#escaped(word, null);
      else if (c === "$") this.#dollar(word, false);
      else if (c === "`") this.#outside();
      else word.add(c, true);
    }
    return word;
  }

  #singleQuoted(word: Builder): void {
    word.quoted = true;
    const end = this.#text.indexOf("'", this.#i);
    if (end < 0) this.skipped = true;
    word.add(this.#text.slice(this.#i, end < 0 ? undefined : end));
    this.#i = end < 0 ? this.#text.length : end + 1;
  }

  // `$'...'`: a backslash escapes the next character, a quote among them.
  #ansiQuoted(): void {
    while (!this.done && this.#peek() !== "'") this.#i += this.#peek() === "\\" ? 2 : 1;
    if (this.done) this.skipped = true;
    this.#i += 1;
  }

  // Inside double quotes (closer `"`) or a heredoc body (closer null): `$` still expands, and backquotes run.
  #doubleQuoted(word: Builder, closer: '"' | null): void {
    word.quoted = true;
    while (!this.done) {
      const c = this.#peek();
      this.#i += 1;
      if (c === closer) return;
      if (c === "\\") this.#escaped(word, '$`"\\\n');
      else if (c === "$") this.#dollar(word, true);
      else if (c === "`") this.#outside();
      else word.add(c);
    }
    if (closer !== null) this.skipped = true;
  }

  // A backslash: a line continuation, or the next character as it is; in double quotes only before `special`.
  #escaped(word: Builder, special: string | null): void {
    if (special === null) word.quoted = true;
    const c = this.#peek();
    this.#i += 1;
    if (c === "\n") return;
    word.add(special === null || special.includes(c) ? c : `\\${c}`);
  }

  // `$`: a parameter, a command or arithmetic substitution, or (outside double quotes) `$'...'` and `$"..."`; each
  // makes the word unknown.
  #dollar(word: Builder, inQuotes: boolean): void {
    const c = this.#peek();
    const name = this.#parameter(c);
    const opens = OPENERS.has(c) && !(inQuotes && (c === "'" || c === '"'));
    if (!opens && name === "") {
      word.add("$");
      return;
    }
    word.expand(!inQuotes);
    this.#i += opens ? 1 : name.length;
    if (opens) this.#expansion(c);
  }

  // The name of a parameter right after a `$`: a word, a digit or a special one such as `$?`; zsh's `$=`, `$~`, `$^`
  // and `$+` expand the name after them.
  #parameter(c: string): string {
    return NAME.exec(this.#text.slice(this.#i))?.[0] ?? (/^[\d?#@*$!=~^+-]$/.test(c) ? c : "");
  }

  // What follows a `$`: a substitution runs, the rest only makes the word unknown.
  #expansion(c: string): void {
    if (c === "(" && this.#peek() === "(") this.#arithmetic();
    else if (c === "(") this.script(")");
    else if (c === "{") this.#braced();
    else if (c === "'") this.#ansiQuoted();
    else if (c === '"') this.#doubleQuoted(new Builder(), '"');
  }

  // `$((...))`: arithmetic, read when it holds no command. bash and zsh run `$((cmd) )`, whose inner `)` is not followed
  // by the outer one, as a command substitution.
  #arithmetic(): void {
    const from = this.#i;
    let depth = 0;
    do {
      const c = this.#peek();
      this.#i += 1;
      if (c === "(") depth += 1;
      else if (c === ")") depth -= 1;
    } while (!this.done && depth > 0);
    if (this.#peek() !== ")" || /\$\(|`/.test(this.#text.slice(from, this.#i))) this.#outside();
    this.#i += 1;
  }

  // `${...}`: unknown, but a substitution inside it still runs, and its quotes hold `}` and `{`. zsh's parameter flags,
  // `${(e)...}` among them, can run what they expand.
  #braced(): void {
    if (this.#peek() === "(") this.#outside();
    let depth = 1;
    while (!this.done && depth > 0) {
      const c = this.#peek();
      this.#i += 1;
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      else if (c === "\\") this.#i += 1;
      else this.#inner(c);
    }
    if (depth > 0) this.skipped = true;
  }

  // A quote, substitution or parameter inside `${...}`.
  #inner(c: string): void {
    if (c === "'") this.#singleQuoted(new Builder());
    else if (c === '"') this.#doubleQuoted(new Builder(), '"');
    else if (c === "$") this.#dollar(new Builder(), false);
    else if (c === "`") this.#outside();
  }
}

/** The commands `text` runs, as the guard reads them. */
export const readShell = (text: string): Script => {
  const reader = new Reader(text);
  reader.script(null);
  reader.finish();
  return { commands: reader.commands, skipped: reader.skipped };
};
