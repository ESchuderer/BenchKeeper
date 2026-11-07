/**
 * A word as the shell passes it: its text when the guard can read all of it (null once an expansion makes it unknown),
 * and its literal start, which is all of it for a read word.
 */
export interface Word {
  readonly text: string | null;
  readonly start: string;
}

/** A simple command: its words, assignments first, and what a heredoc or here-string feeds it. */
export interface Command {
  readonly words: Word[];
  readonly stdin: Word[];
}

/**
 * The simple commands a text runs, those inside command and process substitutions too. `skipped`: the reader passed
 * over text it could not split (an unclosed quote, substitution or heredoc, a `)` without its `(`), which may hide any
 * command. `unmodeled`: a loop, `case`, `select`, `coproc` or function, whose commands are read but not in their order.
 */
export interface Script {
  readonly commands: Command[];
  readonly skipped: boolean;
  readonly unmodeled: boolean;
}

// Words that start a compound command the reader does not follow as a whole.
const UNMODELED = new Set(["for", "case", "select", "function", "coproc"]);
const NAME = /^[A-Za-z_]\w*/;
const OPENERS = new Set(["(", "{", "'", '"']);
const REDIRECT = /^(?:&>>?|<<<|<<-|<<|<>|<&|>&|>>|>\||[<>])/;
// What ends a word outside quotes; a carriage return is no blank to the shell.
const BREAKS = " \t\n;&|()<>";

class Builder {
  text = "";
  start: string | null = null;
  quoted = false;
  add(text: string): void {
    this.text += text;
  }
  // An expansion: the word's text is unknown from here on.
  expand(): void {
    this.start ??= this.text;
  }
  word(): Word {
    return this.start === null ? { text: this.text, start: this.text } : { text: null, start: this.start };
  }
}

interface Heredoc {
  readonly delimiter: string;
  readonly quoted: boolean;
  readonly strip: boolean;
  readonly into: Command;
}

class Reader {
  readonly commands: Command[] = [];
  skipped = false;
  unmodeled = false;
  #i = 0;
  // Open `case` commands, whose patterns end in a `)` without its `(`.
  #cases = 0;
  readonly #text: string;
  readonly #heredocs: Heredoc[] = [];

  constructor(text: string) {
    this.#text = text;
  }

  get done(): boolean {
    return this.#i >= this.#text.length;
  }

  /** Reads commands up to `closer` (the `)` of a substitution or subshell) or the end. */
  script(closer: ")" | null): void {
    let command: Command = { words: [], stdin: [] };
    while (!this.done) {
      const c = this.#peek();
      if (c === closer) {
        this.#i += 1;
        this.#end(command);
        return;
      }
      if (this.#separate(c)) {
        this.#end(command);
        command = { words: [], stdin: [] };
      } else if (!this.#space(c, command)) this.#push(command);
    }
    this.#end(command);
    if (closer !== null) this.skipped = true;
  }

  /** Ends the reading: a heredoc whose body never came was skipped. */
  finish(): void {
    if (this.#heredocs.length > 0) this.skipped = true;
  }

  // Digits right before a redirection name its file descriptor, as 2 in 2>&1, and are no word.
  #push(command: Command): void {
    const word = this.#word().word();
    if (command.words.length === 0 && word.text === "case") this.#cases += 1;
    if (command.words.length === 0 && word.text === "esac") this.#cases -= 1;
    if (!(/^\d+$/.test(word.text ?? "") && /^[<>]$/.test(this.#peek()))) command.words.push(word);
  }

  #peek(offset = 0): string {
    return this.#text.charAt(this.#i + offset);
  }

  #end(command: Command): void {
    if (command.words.length === 0) return;
    if (UNMODELED.has(command.words[0]?.text ?? "")) this.unmodeled = true;
    this.commands.push(command);
  }

  // A character that ends the command: a newline (then its heredocs follow), `;`, `&`, `|` or a `)` with no opener.
  #separate(c: string): boolean {
    if (c === "\n") {
      this.#i += 1;
      this.#readHeredocs();
      return true;
    }
    if (c === "&" && this.#peek(1) === ">") return false;
    if (c === ")" && this.#cases === 0) this.skipped = true;
    if (!";&|)".includes(c)) return false;
    this.#i += this.#peek(1) === c || (c === "|" && this.#peek(1) === "&") ? 2 : 1;
    return true;
  }

  // Blanks, line continuations, comments, subshells and redirections: whatever is no word of the command. True when it
  // took the character.
  #space(c: string, command: Command): boolean {
    if (c === " " || c === "\t" || (c === "\\" && this.#peek(1) === "\n")) {
      this.#i += c === "\\" ? 2 : 1;
      return true;
    }
    if (c !== "#") return this.#opens(c, command);
    while (!this.done && this.#peek() !== "\n") this.#i += 1;
    return true;
  }

  // A subshell or a redirection. `name()` defines a function, whose body runs when it is called.
  #opens(c: string, command: Command): boolean {
    if (c === "(") {
      this.#i += 1;
      if (command.words.length > 0) this.unmodeled = true;
      this.script(")");
      return true;
    }
    if (!/^[<>]$/.test(c) && !(c === "&" && this.#peek(1) === ">")) return false;
    this.#redirect(command);
    return true;
  }

  // A redirection: its target word is no argument; a heredoc's body is read after the line ends; `<(` and `>(` run a
  // process substitution, whose path is the word.
  #redirect(command: Command): void {
    const op = REDIRECT.exec(this.#text.slice(this.#i, this.#i + 3))?.[0] ?? "<";
    if (/^[<>]$/.test(op) && this.#peek(1) === "(") {
      this.#i += 2;
      this.script(")");
      command.words.push({ text: null, start: "" });
      return;
    }
    this.#i += op.length;
    while (this.#peek() === " " || this.#peek() === "\t") this.#i += 1;
    const target = this.#word();
    if (op === "<<<") command.stdin.push(target.word());
    else if (op.startsWith("<<")) this.#heredoc(target, op === "<<-", command);
  }

  #heredoc(target: Builder, strip: boolean, into: Command): void {
    const delimiter = target.word().text;
    if (delimiter === null || delimiter === "") this.skipped = true;
    else this.#heredocs.push({ delimiter, quoted: target.quoted, strip, into });
  }

  #readHeredocs(): void {
    for (const doc of this.#heredocs.splice(0)) {
      const lines: string[] = [];
      let closed = false;
      while (!this.done && !closed) {
        const end = this.#text.indexOf("\n", this.#i);
        const line = this.#text.slice(this.#i, end < 0 ? undefined : end);
        this.#i = end < 0 ? this.#text.length : end + 1;
        closed = (doc.strip ? line.replace(/^\t+/, "") : line) === doc.delimiter;
        if (!closed) lines.push(line);
      }
      if (!closed) this.skipped = true;
      doc.into.stdin.push(this.#body(lines.join("\n"), doc.quoted));
    }
  }

  // A heredoc body: as it is under a quoted delimiter, else read as in double quotes, its substitutions run.
  #body(body: string, quoted: boolean): Word {
    if (quoted) return { text: body, start: body };
    const reader = new Reader(body);
    const word = new Builder();
    reader.#doubleQuoted(word, null);
    this.#adopt(reader);
    return word.word();
  }

  #adopt(script: Script): void {
    this.commands.push(...script.commands);
    this.skipped ||= script.skipped;
    this.unmodeled ||= script.unmodeled;
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
      else if (c === "`") this.#backquoted(word);
      else word.add(c);
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

  // Inside double quotes (closer `"`) or a heredoc body (closer null): `$` and backquotes still expand.
  #doubleQuoted(word: Builder, closer: '"' | null): void {
    word.quoted = true;
    while (!this.done) {
      const c = this.#peek();
      this.#i += 1;
      if (c === closer) return;
      if (c === "\\") this.#escaped(word, '$`"\\\n');
      else if (c === "$") this.#dollar(word, true);
      else if (c === "`") this.#backquoted(word);
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
    word.expand();
    this.#i += opens ? 1 : name.length;
    if (opens) this.#expansion(c);
  }

  // The name of a parameter right after a `$`: a word, a digit or a special one such as `$?`.
  #parameter(c: string): string {
    return NAME.exec(this.#text.slice(this.#i))?.[0] ?? (/^[\d?#@*$!-]$/.test(c) ? c : "");
  }

  // What follows a `$`: a substitution runs, the rest only makes the word unknown.
  #expansion(c: string): void {
    if (c === "(" && this.#peek() === "(") this.#arithmetic();
    else if (c === "(") this.script(")");
    else if (c === "{") this.#braced();
    else if (c === "'") this.#ansiQuoted();
    else if (c === '"') this.#doubleQuoted(new Builder(), '"');
  }

  // `$((...))`: arithmetic, where `<<` shifts; a substitution inside it still runs.
  #arithmetic(): void {
    let depth = 1;
    while (!this.done && depth > 0) {
      const c = this.#peek();
      this.#i += 1;
      if (c === "(") depth += 1;
      else if (c === ")") depth -= 1;
      else if (c === "$" || c === "`") this.#inner(c);
    }
    if (depth > 0) this.skipped = true;
  }

  // `${...}`: unknown, but a substitution inside it still runs, and its quotes hold `}` and `{`.
  #braced(): void {
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

  // A quote, substitution or parameter inside `${...}` or `$((...))`.
  #inner(c: string): void {
    if (c === "'") this.#singleQuoted(new Builder());
    else if (c === '"') this.#doubleQuoted(new Builder(), '"');
    else if (c === "$") this.#dollar(new Builder(), false);
    else if (c === "`") this.#backquoted(new Builder());
  }

  // A backquoted substitution: its text, with `\``, `\\` and `\$` unescaped, runs as a script of its own.
  #backquoted(word: Builder): void {
    word.expand();
    let inner = "";
    while (!this.done && this.#peek() !== "`") {
      const c = this.#peek();
      this.#i += 1;
      inner += c === "\\" && "`\\$".includes(this.#peek()) ? this.#text.charAt(this.#i++) : c;
    }
    if (this.done) this.skipped = true;
    this.#i += 1;
    this.#adopt(readShell(inner));
  }
}

/** The commands `text` runs, as the guard reads them. */
export const readShell = (text: string): Script => {
  const reader = new Reader(text);
  reader.script(null);
  reader.finish();
  return { commands: reader.commands, skipped: reader.skipped, unmodeled: reader.unmodeled };
};
