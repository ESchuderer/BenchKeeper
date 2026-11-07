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
 * The simple commands a text runs, those inside command and process substitutions too, and whether it holds syntax the
 * reader does not model (loops, `case`, functions, an unclosed quote), whose commands the guard cannot tell apart.
 */
export interface Script {
  readonly commands: Command[];
  readonly unread: boolean;
}

// Words that start a compound command whose words the reader does not follow.
const UNMODELED = new Set(["for", "case", "select", "function", "coproc"]);
const NAME = /^[A-Za-z_]\w*/;
const OPENERS = new Set(["(", "{", "'", '"']);
const REDIRECT = /^(?:&>>?|<<<|<<-|<<|<>|<&|>&|>>|>\||[<>])/;

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
  unread = false;
  #i = 0;
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
    if (closer !== null) this.unread = true;
  }

  // Digits right before a redirection name its file descriptor, as 2 in 2>&1, and are no word.
  #push(command: Command): void {
    const word = this.#word().word();
    if (!(/^\d+$/.test(word.text ?? "") && /^[<>]$/.test(this.#peek()))) command.words.push(word);
  }

  /** Ends the reading: a heredoc whose body never came leaves the text unread. */
  finish(): void {
    if (this.#heredocs.length > 0) this.unread = true;
  }

  #peek(offset = 0): string {
    return this.#text.charAt(this.#i + offset);
  }

  #end(command: Command): void {
    if (command.words.length === 0) return;
    if (UNMODELED.has(command.words[0]?.text ?? "")) this.unread = true;
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
    if (c === ")") this.unread = true;
    if (!";&|)".includes(c)) return false;
    this.#i += this.#peek(1) === c || (c === "|" && this.#peek(1) === "&") ? 2 : 1;
    return true;
  }

  // Blanks, comments, subshells and redirections: whatever is no word of the command. True when it took the character.
  #space(c: string, command: Command): boolean {
    if (/^[ \t\r]$/.test(c)) {
      this.#i += 1;
      return true;
    }
    if (c !== "#") return this.#opens(c, command);
    while (!this.done && this.#peek() !== "\n") this.#i += 1;
    return true;
  }

  // A subshell or a redirection. `name()` defines a function, whose body the reader does not follow.
  #opens(c: string, command: Command): boolean {
    if (c === "(") {
      this.#i += 1;
      if (command.words.length > 0) this.unread = true;
      this.script(")");
      return true;
    }
    if (!/^[<>]$/.test(c) && !(c === "&" && this.#peek(1) === ">")) return false;
    this.#redirect(command);
    return true;
  }

  // A redirection: its target word is no argument; a heredoc's body is read after the line ends; `<(` and `>(` run a
  // process substitution.
  #redirect(command: Command): void {
    const op = REDIRECT.exec(this.#text.slice(this.#i, this.#i + 3))?.[0] ?? "<";
    if (/^[<>]$/.test(op) && this.#peek(1) === "(") {
      this.#i += 2;
      this.script(")");
      command.words.push({ text: null, start: "" });
      return;
    }
    this.#i += op.length;
    while (/^[ \t]$/.test(this.#peek())) this.#i += 1;
    const target = this.#word();
    if (op === "<<<") command.stdin.push(target.word());
    else if (op.startsWith("<<")) this.#heredoc(target, op === "<<-", command);
  }

  #heredoc(target: Builder, strip: boolean, into: Command): void {
    const delimiter = target.word().text;
    if (delimiter === null || delimiter === "") this.unread = true;
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
      if (!closed) this.unread = true;
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

  #adopt(reader: Script): void {
    this.commands.push(...reader.commands);
    if (reader.unread) this.unread = true;
  }

  // One word, up to a blank or an operator; at least one character, so a reader always moves on.
  #word(): Builder {
    const word = new Builder();
    if (" \t\r\n;&|()<>".includes(this.#peek())) word.add(this.#text.charAt(this.#i++));
    while (!this.done && !" \t\r\n;&|()<>".includes(this.#peek())) {
      const c = this.#peek();
      this.#i += 1;
      if (c === "'") this.#singleQuoted(word);
      else if (c === '"') this.#doubleQuoted(word, '"');
      else if (c === "\\") this.#escaped(word, null);
      else if (c === "$") this.#dollar(word);
      else if (c === "`") this.#backquoted(word);
      else word.add(c);
    }
    return word;
  }

  #singleQuoted(word: Builder): void {
    word.quoted = true;
    const end = this.#text.indexOf("'", this.#i);
    if (end < 0) this.unread = true;
    word.add(this.#text.slice(this.#i, end < 0 ? undefined : end));
    this.#i = end < 0 ? this.#text.length : end + 1;
  }

  // Inside double quotes (closer `"`) or a heredoc body (closer null): `$` and backquotes still expand.
  #doubleQuoted(word: Builder, closer: '"' | null): void {
    word.quoted = true;
    while (!this.done) {
      const c = this.#peek();
      this.#i += 1;
      if (c === closer) return;
      if (c === "\\") this.#escaped(word, '$`"\\\n');
      else if (c === "$") this.#dollar(word);
      else if (c === "`") this.#backquoted(word);
      else word.add(c);
    }
    if (closer !== null) this.unread = true;
  }

  // A backslash: a line continuation, or the next character as it is; in double quotes only before `special`.
  #escaped(word: Builder, special: string | null): void {
    if (special === null) word.quoted = true;
    const c = this.#peek();
    this.#i += 1;
    if (c === "\n") return;
    word.add(special === null || special.includes(c) ? c : `\\${c}`);
  }

  // `$`: a parameter, a command or arithmetic substitution, or `$'...'`; each makes the word unknown.
  #dollar(word: Builder): void {
    const c = this.#peek();
    const name = NAME.exec(this.#text.slice(this.#i))?.[0] ?? (/^[\d?#@*$!-]$/.test(c) ? c : "");
    if (!OPENERS.has(c) && name === "") {
      word.add("$");
      return;
    }
    word.expand();
    this.#i += OPENERS.has(c) ? 1 : name.length;
    this.#expansion(c);
  }

  // What follows a `$`: a substitution runs, the rest only makes the word unknown.
  #expansion(c: string): void {
    if (c === "(") this.script(")");
    else if (c === "{") this.#braced();
    else if (c === "'") this.#singleQuoted(new Builder());
    else if (c === '"') this.#doubleQuoted(new Builder(), '"');
  }

  // `${...}`: unknown, but a substitution inside it still runs.
  #braced(): void {
    let depth = 1;
    while (!this.done && depth > 0) {
      const c = this.#peek();
      this.#i += 1;
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      else if (c === "$" && this.#peek() === "(") this.#dollar(new Builder());
      else if (c === "`") this.#backquoted(new Builder());
      else if (c === "\\") this.#i += 1;
    }
    if (depth > 0) this.unread = true;
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
    if (this.done) this.unread = true;
    this.#i += 1;
    this.#adopt(readShell(inner));
  }
}

/** The commands `text` runs, as the guard reads them. */
export const readShell = (text: string): Script => {
  const reader = new Reader(text);
  reader.script(null);
  reader.finish();
  return { commands: reader.commands, unread: reader.unread };
};
