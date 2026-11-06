import {
  CATALOG_LIMITS,
  type Catalog,
  isPlainText,
  ExtensionManifest,
  readCatalog,
  shown,
  translate,
} from "@cedarloom/contracts";
import { expect, test } from "vitest";

// A German catalog as Lingui or msgmerge writes one.
const german = [
  "# German translations of the Jira extension",
  'msgid ""',
  'msgstr ""',
  '"Content-Type: text/plain; charset=UTF-8\\n"',
  '"Language: de\\n"',
  "",
  "#. The action's title",
  'msgid "Search issues"',
  'msgstr "Vorgänge suchen"',
  "",
  'msgid ""',
  '"Runs a JQL query "',
  '"in {project}."',
  'msgstr ""',
  '"Führt eine JQL-Abfrage "',
  '"in {project} aus."',
  "",
  "#, fuzzy",
  'msgid "Write a report"',
  'msgstr "Einen Bericht schreiben"',
  "",
  'msgid "Not translated yet"',
  'msgstr ""',
  "",
  'msgctxt "button"',
  'msgid "Open"',
  'msgstr "Öffnen"',
  "",
  'msgid "{count} issue"',
  'msgid_plural "{count} issues"',
  'msgstr[0] "{count} Vorgang"',
  'msgstr[1] "{count} Vorgänge"',
  "",
  'msgid "Found {count} in {project}"',
  'msgstr "{count} gefunden"',
  "",
  'msgid "A \\"quoted\\" word and a \\\\ backslash"',
  'msgstr "Das \\"zitierte\\" Wort und der \\\\ Backslash"',
].join("\r\n");

test("a PO catalog gives the translations gettext would use, plain text shown as is", () => {
  const read = readCatalog(german);
  expect(read.ok ? Object.fromEntries(read.value) : read).toEqual({
    "Search issues": "Vorgänge suchen",
    "Runs a JQL query in {project}.": "Führt eine JQL-Abfrage in {project} aus.",
    "Found {count} in {project}": "{count} gefunden",
    'A "quoted" word and a \\ backslash': 'Das "zitierte" Wort und der \\ Backslash',
  });
});

const problem = (text: string): unknown => {
  const read = readCatalog(text);
  return read.ok ? "read" : read.finding.params;
};

test("a line that is no PO, a broken string or escape, a duplicate, a second msgid or msgstr, or unsafe text is refused with its line", () => {
  const cases: [string, string][] = [
    ['msgid "a"\nmsgstr "b"\nnot po', "line 3 unexpected_line"],
    ['msgid "a\nmsgstr "b"', "line 1 bad_string"],
    ['msgid "a" trailing\nmsgstr "b"', "line 1 bad_string"],
    ['msgid "a\\q"\nmsgstr "b"', "line 1 bad_escape"],
    ['msgid "a"\nmsgstr "b"\n\nmsgid "a"\nmsgstr "c"', "line 6 duplicate_msgid"],
    ['msgid "a"\nmsgid "b"\nmsgstr "c"', "line 2 unexpected_line"],
    ['"continues nothing"', "line 1 unexpected_line"],
    ['msgid "a"\nmsgstr "b"\nmsgstr "c"', "line 3 unexpected_line"],
    ['msgstr "b"\nmsgid "a"', "line 1 unexpected_line"],
    ['msgid "a"\nmsgstr "a line\\nbreak"', "line 3 unsafe_character"],
    ['msgid "a"\nmsgstr "reversed \u202e text"', "line 3 unsafe_character"],
    ['msgid "an \u001b[2K escape"\nmsgstr "b"', "line 3 unsafe_character"],
  ];
  expect(cases.map(([text]) => problem(text))).toEqual(
    cases.map(([, issue]) => {
      const [, line, code] = issue.split(" ");
      return { issues: [{ path: `line ${line}`, code }] };
    }),
  );
});

test("a catalog over the bounds is refused: its size, its entries, one text", () => {
  const entries = Array.from({ length: CATALOG_LIMITS.entries + 1 }, (_, index) => `msgid "m${index}"\nmsgstr "t"\n`);
  const long = "x".repeat(CATALOG_LIMITS.text + 1);
  const halves = `msgid "${long.slice(0, 1500)}"\n"${long.slice(1500)}"\nmsgstr "t"`;
  const results = [
    problem(`# ${"x".repeat(CATALOG_LIMITS.bytes)}`),
    problem(entries.join("\n")),
    problem(`msgid "${long}"\nmsgstr "t"`),
    problem(halves),
  ];
  expect(results.map((result) => JSON.stringify(result))).toEqual([
    JSON.stringify({ issues: [{ path: "line 1", code: "too_big" }] }),
    // Each entry takes three lines, so the one over the bound ends on its blank line.
    JSON.stringify({ issues: [{ path: `line ${3 * CATALOG_LIMITS.entries + 3}`, code: "too_big" }] }),
    JSON.stringify({ issues: [{ path: "line 1", code: "too_big" }] }),
    JSON.stringify({ issues: [{ path: "line 2", code: "too_big" }] }),
  ]);
});

test("a text in the user's language: the locale, then its base language, then the manifest's English", () => {
  const catalogs = new Map<string, Catalog>([
    ["pt-BR", new Map([["Search issues", "Pesquisar tickets"]])],
    [
      "pt",
      new Map([
        ["Search issues", "Procurar pedidos"],
        ["Write a report", "Escrever um relatório"],
      ]),
    ],
    ["zh-Hant", new Map([["Search issues", "搜尋問題"]])],
  ]);
  const texts = [
    translate("Search issues", "pt-BR", catalogs),
    translate("Write a report", "pt-BR", catalogs),
    translate("Search issues", "pt-PT", catalogs),
    translate("Search issues", "zh-Hant-TW", catalogs),
    translate("Search issues", "de", catalogs),
    translate("Unknown text", "pt", catalogs),
    translate("Search issues", "pt_br", catalogs),
    translate("Search issues", "pt_BR.UTF-8", catalogs),
    translate("Search issues", "pt_PT@euro", catalogs),
    translate("Search issues", "not a tag!", catalogs),
  ];
  expect(texts).toEqual([
    "Pesquisar tickets",
    "Escrever um relatório",
    "Procurar pedidos",
    "搜尋問題",
    "Search issues",
    "Unknown text",
    "Pesquisar tickets",
    "Pesquisar tickets",
    "Procurar pedidos",
    "Search issues",
  ]);
});

const manifestNamed = (name: string) =>
  ExtensionManifest.safeParse({
    schemaVersion: 1,
    kind: "cedarloom.extension",
    id: "acme.jira",
    version: "1.0.0",
    name,
    api: "1.0",
    runtime: { kind: "node", entry: "main.js" },
    contributes: { actions: { go: { title: "Go" } } },
  }).success;

test("plain text: no control or bidirectional character in a manifest text, and other programs' text shown safely", () => {
  const texts = ["Vorgänge suchen", "搜尋問題", "a\u001b[2Kb", "a\u202eb", "tab\tbed", "line\nbreak"];
  expect([texts.map(isPlainText), texts.map(manifestNamed), shown("a\u001b[2Kb\r\nc\u202ed é", 11)]).toEqual([
    [true, true, false, false, false, false],
    [true, true, false, false, false, false],
    "a\\u001b[2Kb",
  ]);
});
