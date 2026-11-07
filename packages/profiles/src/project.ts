import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { type Finding, type Operation, type Result, targetClass } from "@cedarloom/contracts";
import { hashFile } from "@cedarloom/engine";
import { sha256 } from "@cedarloom/ledger";
import { onDisk, textOf, unknownApprovals } from "./machine.ts";
import { type LevelPlan, ownedFiles, type Wanted } from "./owned.ts";
import { type Resolved, textFile } from "./resolve.ts";
import type { Fetched } from "./skills.ts";

type Part = Resolved["profile"]["project"][string];
type Of<T extends Part["type"]> = Extract<Part, { type: T }>;
type Markers = readonly [string, string];

const refuse = (finding: Finding): Result<never> => ({ ok: false, finding });

const MARKDOWN: Markers = ["<!-- cedarloom start -->", "<!-- cedarloom end -->"];
const EXCLUDE: Markers = ["# cedarloom start", "# cedarloom end"];

// Where CedarLoom's block lies: none when the text has none, or null when its markers are broken (one alone, one twice,
// or out of order), where a write must not guess what is the owner's.
const blockAt = (text: string, [start, end]: Markers): { from: number; to: number } | undefined | null => {
  const [from, to] = [text.indexOf(start), text.indexOf(end)];
  if (from < 0 && to < 0) return undefined;
  const once = text.indexOf(start, from + 1) < 0 && text.indexOf(end, to + 1) < 0;
  return from >= 0 && to > from && once ? { from, to: to + end.length } : null;
};

// The text with CedarLoom's block set to `body`, or taken out when it is null; the lines outside it stay.
const withBlock = (text: string, markers: Markers, body: string | null): string | null => {
  const at = blockAt(text, markers);
  if (at === null) return null;
  const block = body === null ? "" : `${markers[0]}\n${body}${markers[1]}\n`;
  if (at === undefined) {
    if (body === null || text === "") return text + block;
    return `${text.endsWith("\n") ? text : `${text}\n`}\n${block}`;
  }
  const [head, tail] = [text.slice(0, at.from), text.slice(at.to).replace(/^\r?\n/, "")];
  // Taking the block out takes the blank line that set it apart from the owner's text too.
  return body === null && tail === "" ? head.replace(/\n\n$/, "\n") : head + block + tail;
};

// The operation that sets a file's block, through a link to the file it names; a file the block alone made goes with it.
const blockWrite = (file: string, markers: Markers, body: string | null): Result<Operation[]> => {
  const path = onDisk(file);
  const text = textFile(path);
  if (!text.ok) return text;
  const next = withBlock(text.value ?? "", markers, body);
  if (next === null)
    return refuse({ code: "document.unreadable", params: { path, error: "a broken cedarloom block" } });
  if (next === (text.value ?? "")) return { ok: true, value: [] };
  const before = text.value === null ? null : sha256(text.value);
  if (next.trim() !== "") return { ok: true, value: [{ kind: "write", path, before, content: next }] };
  return { ok: true, value: before === null ? [] : [{ kind: "delete", path, before }] };
};

const partsOn = <T extends Part["type"]>({ profile, on }: Resolved, type: T): [string, Of<T>][] =>
  Object.entries(profile.project).filter(
    (entry): entry is [string, Of<T>] => entry[1].type === type && on.has(`project.${entry[0]}`),
  );

// The rules of the parts of one type that are on, in profile order, each ending in a line break; a part that requires
// one `held` back for its approval is left out with it.
type Context = { resolved: Resolved; fetched: Fetched; held: ReadonlySet<string> };
const rulesOf = ({ resolved, fetched, held }: Context, type: "manual" | "local-manual"): Result<string[]> => {
  const texts: string[] = [];
  const parts = partsOn(resolved, type).filter(([, part]) => !(part.requires ?? []).some((each) => held.has(each)));
  for (const [id, part] of parts) {
    for (const [at, text] of part.rules.entries()) {
      const read = textOf(text, { kind: "rules", pointer: `/project/${id}/rules/${at}` }, resolved, fetched);
      if (!read.ok) return read;
      texts.push(read.value.endsWith("\n") ? read.value : `${read.value}\n`);
    }
  }
  return { ok: true, value: texts };
};

type Files = {
  wanted: Map<string, Wanted>;
  stale: string[];
  excluded: string[];
  held: Set<string>;
  findings: Finding[];
};

// A files part that is on: its targets, made executable when they are, or none and an approval line while it writes an
// executable or configuration target `approved` does not name (owner, hub issue 130).
const filesPart = (id: string, part: Of<"files">, resolved: Resolved, fetched: Fetched) => {
  const found: [string, string][] = [];
  for (const [target, text] of Object.entries(part.files)) {
    const pointer = `/project/${id}/files/${target.replaceAll("~", "~0").replaceAll("/", "~1")}`;
    const read = textOf(text, { kind: "template", pointer }, resolved, fetched);
    if (!read.ok) return read;
    found.push([target, read.value]);
  }
  const targets = found.filter(([target, text]) => targetClass(target, text) !== "text").map(([target]) => target);
  return { ok: true as const, value: { found, targets } };
};

const targetPath = (project: string, target: string): string => join(project, ...target.split("/"));

// A files part that is on and approved: each target it writes now, and the targets Git is to ignore.
const addTargets = (files: Files, project: string, part: Of<"files">, found: [string, string][]): void => {
  for (const [target, content] of found) {
    const path = targetPath(project, target);
    if (part.onlyIfAbsent === true && existsSync(path)) continue;
    const mode = targetClass(target, content) === "executable" ? { mode: 0o755 } : {};
    files.wanted.set(path, { content, ...mode });
  }
  if (!part.commit) files.excluded.push(...Object.keys(part.files));
};

// Whether every target already holds its text: an approved part's files in place need no new approval.
const inPlace = (project: string, found: [string, string][]): boolean =>
  found.every(([target, content]) => {
    try {
      return hashFile(targetPath(project, target)) === sha256(content);
    } catch {
      return false;
    }
  });

const filesOf = (resolved: Resolved, project: string, fetched: Fetched, approved: ReadonlySet<string>) => {
  const files: Files = { wanted: new Map(), stale: [], excluded: [], held: new Set(), findings: [] };
  for (const [id, part] of Object.entries(resolved.profile.project)) {
    if (part.type !== "files") continue;
    if (!resolved.on.has(`project.${id}`)) {
      files.stale.push(...Object.keys(part.files).map((target) => targetPath(project, target)));
      continue;
    }
    const read = filesPart(id, part, resolved, fetched);
    if (!read.ok) return read;
    const { found, targets } = read.value;
    if (targets.length === 0 || approved.has(`project.${id}`) || inPlace(project, found)) {
      addTargets(files, project, part, found);
      continue;
    }
    files.findings.push({ code: "profile.target-approval", params: { part: `project.${id}`, targets } });
    files.held.add(`project.${id}`);
  }
  return { ok: true as const, value: files };
};

// The exclude file Git reads for a repository whose `.git` is in `root`: in its common Git folder, also from a linked
// worktree, whose `.git` file names its own folder; null when `root` holds no `.git`.
const excludeAt = (root: string): string | null => {
  const dotGit = join(root, ".git");
  const found = statSync(dotGit, { throwIfNoEntry: false });
  if (found?.isDirectory() === true) return join(dotGit, "info", "exclude");
  const gitdir =
    found?.isFile() === true ? /^gitdir: (.+)$/m.exec(readFileSync(dotGit, "utf8"))?.[1]?.trim() : undefined;
  if (gitdir === undefined) return null;
  const folder = resolve(root, gitdir);
  const common = join(folder, "commondir");
  return join(existsSync(common) ? resolve(folder, readFileSync(common, "utf8").trim()) : folder, "info", "exclude");
};

// The repository a folder lies in, the folder's own or a parent's, with its exclude file; null outside Git.
const repositoryOf = (project: string): { root: string; exclude: string } | null => {
  for (let root = project; ; root = dirname(root)) {
    const exclude = excludeAt(root);
    if (exclude !== null) return { root, exclude };
    if (dirname(root) === root) return null;
  }
};

// The Git exclude block with the project's machine-local files, each anchored at its path from the repository's root.
const excludeWrites = (project: string, targets: string[]): Result<Operation[]>[] => {
  const repository = repositoryOf(project);
  if (repository === null) return [];
  const lines = targets.map(
    (target) => `/${relative(repository.root, targetPath(project, target)).split(sep).join("/")}`,
  );
  return [blockWrite(repository.exclude, EXCLUDE, lines.length === 0 ? null : `${lines.join("\n")}\n`)];
};

// AGENTS.md's block: the manual's rules, then the default tier when one is set.
const agentsBody = (context: Context): Result<string | null> => {
  const rules = rulesOf(context, "manual");
  if (!rules.ok) return rules;
  const tier = partsOn(context.resolved, "tier").at(-1)?.[1].tier ?? null;
  const lines = [...rules.value, ...(tier === null ? [] : [`Default tier: ${tier}\n`])];
  return { ok: true, value: lines.length === 0 ? null : lines.join("") };
};

// CLAUDE.local.md's block: the machine-local rules, then `@AGENTS.md` when CLAUDE.md does not import it.
const localBody = (context: Context, imported: boolean): Result<string | null> => {
  const rules = rulesOf(context, "local-manual");
  if (!rules.ok || rules.value.length === 0) return rules.ok ? { ok: true, value: null } : rules;
  return { ok: true, value: [...rules.value, ...(imported ? [] : ["@AGENTS.md\n"])].join("") };
};

// The manual's writes: its two blocks, and a CLAUDE.md that holds only `@AGENTS.md` when there is none (D31).
const manualWrites = (context: Context, project: string) => {
  const claude = textFile(join(project, "CLAUDE.md"));
  if (!claude.ok) return claude;
  const create = claude.value === null && partsOn(context.resolved, "manual").some(([, part]) => part.claudeImport);
  const agents = agentsBody(context);
  if (!agents.ok) return agents;
  const local = localBody(context, create || /^@AGENTS\.md[ \t]*$/m.test(claude.value ?? ""));
  if (!local.ok) return local;
  const writes = [
    blockWrite(join(project, "AGENTS.md"), MARKDOWN, agents.value),
    blockWrite(join(project, "CLAUDE.local.md"), MARKDOWN, local.value),
  ];
  const path = join(project, "CLAUDE.md");
  const created: Operation[] = create ? [{ kind: "write", path, before: null, content: "@AGENTS.md\n" }] : [];
  return { ok: true as const, value: { writes, created, local: local.value !== null } };
};

/**
 * The project level for one folder: the manual's marked blocks, each files part's targets (an executable or
 * configuration one only when `approved` names its part), and the Git exclude block for the machine-local files.
 * `written` holds what CedarLoom last left at each path of the project (the run store's `written`).
 */
export const planProject = (
  resolved: Resolved,
  project: string,
  written: ReadonlyMap<string, string | null>,
  { approved = new Set<string>(), fetched = new Map() }: { approved?: ReadonlySet<string>; fetched?: Fetched } = {},
): Result<LevelPlan> => {
  const unknown = unknownApprovals(resolved, approved, "project", "files");
  if (unknown.length > 0) return { ok: true, value: { operations: [], findings: unknown } };
  const files = filesOf(resolved, project, fetched, approved);
  if (!files.ok) return files;
  const manual = manualWrites({ resolved, fetched, held: files.value.held }, project);
  if (!manual.ok) return manual;
  const owned = ownedFiles(files.value.wanted, files.value.stale, written);
  if (!owned.ok) return owned;
  const lines = [...(manual.value.local ? ["CLAUDE.local.md"] : []), ...files.value.excluded];
  const writes = [...manual.value.writes, ...excludeWrites(project, lines)];
  const failed = writes.find((write) => !write.ok);
  if (failed !== undefined) return failed;
  const operations = [
    ...writes.flatMap((write) => (write.ok ? write.value : [])),
    ...manual.value.created,
    ...owned.value.operations,
  ];
  return { ok: true, value: { operations, findings: [...files.value.findings, ...owned.value.findings] } };
};
