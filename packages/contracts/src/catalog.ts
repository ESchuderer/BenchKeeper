import type { Result } from "./documents.ts";
import { isPlainText } from "./escape.ts";

/** An extension's catalog for one language: each English text of its manifest to the text in that language. */
export type Catalog = ReadonlyMap<string, string>;

/** Bounds for a catalog from elsewhere: its size, its entries, and the length of one text. */
export const CATALOG_LIMITS = { bytes: 256 * 1024, entries: 2000, text: 2000 };

type Entry = { msgid?: string; msgstr?: string; skip: boolean };
type Field = "msgid" | "msgstr" | "other";
type Problem = { line: number; code: string };

const refused = ({ line, code }: Problem): Result<never> => ({
  ok: false,
  finding: { code: "document.invalid", params: { issues: [{ path: `line ${line}`, code }] } },
});

const ESCAPES = new Map([
  ["n", "\n"],
  ["t", "\t"],
  ["r", "\r"],
  ['"', '"'],
  ["\\", "\\"],
]);

/** The text of a quoted PO string with its escapes, or the code of what is wrong with it. */
const unquote = (quoted: string): string | { code: string } => {
  if (!/^"(?:[^"\\]|\\.)*"$/.test(quoted)) return { code: "bad_string" };
  const body = quoted.slice(1, -1);
  // Escape pairs read left to right, so `\\n` is a backslash and an n.
  const escaped = [...body.matchAll(/\\(.)/g)].map(([, char]) => char ?? "");
  if (escaped.some((char) => !ESCAPES.has(char))) return { code: "bad_escape" };
  const text = body.replace(/\\(.)/g, (_, char: string) => ESCAPES.get(char) ?? char);
  return text.length > CATALOG_LIMITS.text ? { code: "too_big" } : text;
};

/**
 * Keeps a finished entry: a translated message, not the header, not fuzzy, plural or in a context. Its texts are plain
 * text, as the manifest's are: shown as is, with no value formatted into them, so no placeholder needs checking.
 */
const keep = (entry: Entry, messages: Map<string, string>): string | undefined => {
  const { msgid = "", msgstr = "" } = entry;
  if (entry.skip || msgid === "" || msgstr === "") return undefined;
  if (!isPlainText(msgid) || !isPlainText(msgstr)) return "unsafe_character";
  if (messages.has(msgid)) return "duplicate_msgid";
  messages.set(msgid, msgstr);
  return undefined;
};

// A line's keyword and quoted rest: `msgid "x"`, `msgstr "x"`, a continuation `"x"`, or another gettext keyword.
const KEYWORD = /^(msgid|msgstr|msgctxt|msgid_plural|msgstr\[\d+\])?[ \t]*("[\s\S]*)$/;

/**
 * Reads an extension's PO catalog, the gettext format Lingui reads too
 * (https://www.gnu.org/software/gettext/manual/html_node/PO-Files.html): entries of a `msgid`, the English text, and a
 * `msgstr`, its translation, each a quoted string that more quoted lines continue. As gettext does, the header entry,
 * fuzzy entries (`#, fuzzy`) and empty translations are not used; entries in a context or with plural forms name no
 * manifest text and are skipped too. A file over the bounds, with a line that is none of these, or with a text that
 * holds a control or bidirectional character, is refused whole.
 */
export const readCatalog = (text: string): Result<Catalog> => {
  if (new TextEncoder().encode(text).length > CATALOG_LIMITS.bytes) return refused({ line: 1, code: "too_big" });
  const messages = new Map<string, string>();
  let entry: Entry = { skip: false };
  let field: Field = "other";
  const lines = [...text.split(/\r?\n/), ""];
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    const next = step(line, entry, field);
    if ("code" in next) return refused({ line: index + 1, code: next.code });
    if (next.ended) {
      const problem = keep(entry, messages);
      if (problem !== undefined) return refused({ line: index + 1, code: problem });
      if (messages.size > CATALOG_LIMITS.entries) return refused({ line: index + 1, code: "too_big" });
    }
    ({ entry, field } = next);
  }
  return { ok: true, value: messages };
};

type Step = { entry: Entry; field: Field; ended: boolean } | { code: string };

// A comment, or the flags of the entry: a fuzzy translation is not used.
const comment = (line: string, entry: Entry, field: Field): Step => {
  const fuzzy = line.startsWith("#,") && /\bfuzzy\b/.test(line);
  return { entry: fuzzy ? { ...entry, skip: true } : entry, field, ended: false };
};

// msgid and msgstr set their field; a context or plural forms mark an entry that names no manifest text. Entries are
// separated by blank lines, as gettext writes them, so a second msgid or msgstr in one entry, or a msgstr before its
// msgid, is refused.
const keyworded = (keyword: string, part: string, entry: Entry): Step => {
  if (keyword === "msgid" || keyword === "msgstr") {
    if (entry[keyword] !== undefined || (keyword === "msgstr" && entry.msgid === undefined)) {
      return { code: "unexpected_line" };
    }
    return { entry: { ...entry, [keyword]: part }, field: keyword, ended: false };
  }
  return { entry: { ...entry, skip: true }, field: "other", ended: false };
};

/** One line read into the entry: a blank line that ends it, a comment or flag, a keyword, or a continuation. */
const step = (line: string, entry: Entry, field: Field): Step => {
  if (line === "") return { entry: { skip: false }, field: "other", ended: true };
  if (line.startsWith("#")) return comment(line, entry, field);
  const match = KEYWORD.exec(line);
  if (match === null) return { code: "unexpected_line" };
  const [, keyword, quoted = ""] = match;
  const part = unquote(quoted);
  if (typeof part !== "string") return part;
  return keyword === undefined ? continued(entry, field, part) : keyworded(keyword, part, entry);
};

// A quoted line that continues the msgid or msgstr before it; after anything else it has nothing to continue.
const continued = (entry: Entry, field: Field, part: string): Step => {
  if (field === "other") return entry.skip ? { entry, field, ended: false } : { code: "unexpected_line" };
  const joined = `${entry[field] ?? ""}${part}`;
  return joined.length > CATALOG_LIMITS.text
    ? { code: "too_big" }
    : { entry: { ...entry, [field]: joined }, field, ended: false };
};

// The canonical form of a language tag, as the manifest's catalog keys are written: `pt_br` is `pt-BR`, and a POSIX
// locale such as `de_DE.UTF-8` or `sr_RS@latin` is `de-DE` or `sr-RS` (its encoding and modifier dropped); none for a
// tag that is no language tag.
const canonical = (locale: string): string => {
  const [tag = ""] = locale.split(/[.@]/);
  try {
    return Intl.getCanonicalLocales(tag.replaceAll("_", "-"))[0] ?? "";
  } catch {
    return "";
  }
};

/**
 * A text in the user's language: its translation for the locale in its canonical form, then for the locale without
 * its last part (`pt-BR`, then `pt`), else the English text itself.
 */
export const translate = (english: string, locale: string, catalogs: ReadonlyMap<string, Catalog>): string => {
  const parts = canonical(locale).split("-");
  for (let count = parts.length; count > 0; count -= 1) {
    const text = catalogs.get(parts.slice(0, count).join("-"))?.get(english);
    if (text !== undefined) return text;
  }
  return english;
};
