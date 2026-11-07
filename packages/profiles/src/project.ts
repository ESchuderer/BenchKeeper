import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { type Finding, type Operation, type Result, sealedTarget, targetClass } from "@cedarloom/contracts";
import { errorCode, hashFile } from "@cedarloom/engine";
import { sha256 } from "@cedarloom/ledger";
import { fileWrite, mergeSets, onDisk, textOf, unknownApprovals, waiting, withPlugins, within } from "./machine.ts";
import { type LevelPlan, ownedFiles, type Wanted } from "./owned.ts";
import { type Resolved, textFile } from "./resolve.ts";
import { type Fetched, skillFiles } from "./skills.ts";

type Part = Resolved["profile"]["project"][string];
type Of<T extends Part["type"]> = Extract<Part, { type: T }>;
type Markers = readonly [string, string];

const refuse = (finding: Finding): Result<never> => ({ ok: false, finding });

const MARKDOWN: Markers = ["<!-- cedarloom start -->", "<!-- cedarloom end -->"];
// One block per project in its repository's exclude file, named by the project's path from the repository's root.
const excludeMarkers = (anchor: string): Markers => [`# cedarloom start ${anchor}`, `# cedarloom end ${anchor}`];

// Where each line that is the marker alone starts, a carriage return before its break allowed: a marker the owner
// quotes inside a line is text.
const markerLines = (text: string, marker: string): number[] => {
  const found: number[] = [];
  let at = 0;
  for (const line of text.split("\n")) {
    if (line === marker || line === `${marker}\r`) found.push(at);
    at += line.length + 1;
  }
  return found;
};

// Where CedarLoom's block lies: none when the text has none, or null when its markers are broken (one alone, one twice,
// or out of order), where a write must not guess what is the owner's.
const blockAt = (text: string, [start, end]: Markers): { from: number; to: number } | undefined | null => {
  const [starts, ends] = [markerLines(text, start), markerLines(text, end)];
  if (starts.length === 0 && ends.length === 0) return undefined;
  const [from = -1, to = -1] = [starts[0], ends[0]];
  return starts.length === 1 && ends.length === 1 && to > from ? { from, to: to + end.length } : null;
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

// The rules of the parts of one type that are on, in profile order, each ending in one line break; a part that requires
// one `held` back for its approval is left out with it.
type Context = { resolved: Resolved; fetched: Fetched; held: ReadonlySet<string> };
type Written = ReadonlyMap<string, string | null>;
const rulesOf = ({ resolved, fetched, held }: Context, type: "manual" | "local-manual"): Result<string[]> => {
  const texts: string[] = [];
  const parts = partsOn(resolved, type).filter(([, part]) => !(part.requires ?? []).some((each) => held.has(each)));
  for (const [id, part] of parts) {
    for (const [at, text] of part.rules.entries()) {
      const read = textOf(text, { kind: "rules", pointer: `/project/${id}/rules/${at}` }, resolved, fetched);
      if (!read.ok) return read;
      texts.push(`${read.value.trimEnd()}\n`);
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
type Found = { target: string; path: string; content: string };

const hashOf = (path: string): string | null => {
  try {
    return hashFile(path);
  } catch {
    return null;
  }
};

// A target's path on disk; refused when a link leads it outside the project, into its Git folder or onto a file only
// its own parts write, which the profile's portable paths cannot name but a link can reach.
const realTarget = (project: string, part: string, target: string): Result<string> => {
  const path = onDisk(join(project, ...target.split("/")));
  const inside = relative(project, path).split(sep).join("/");
  const git = inside.split("/").some((segment) => segment.toLowerCase() === ".git");
  if (within(path, project) && !git && !sealedTarget(inside)) return { ok: true, value: path };
  return refuse({ code: "profile.target-linked", params: { part, target, path } });
};

type Given = { resolved: Resolved; project: string; fetched: Fetched; approved: ReadonlySet<string> };

// A files part's targets with their texts and their paths on disk.
const filesPart = ({ resolved, project, fetched }: Given, id: string, part: Of<"files">) => {
  const found: Found[] = [];
  for (const [target, text] of Object.entries(part.files)) {
    const pointer = `/project/${id}/files/${target.replaceAll("~", "~0").replaceAll("/", "~1")}`;
    const read = textOf(text, { kind: "template", pointer }, resolved, fetched);
    if (!read.ok) return read;
    const path = realTarget(project, `project.${id}`, target);
    if (!path.ok) return path;
    found.push({ target, path: path.value, content: read.value });
  }
  return { ok: true as const, value: found };
};

// A files part that is on and approved: each target it writes now, and those Git is to ignore. An `onlyIfAbsent`
// target that is there stays as it is, ignored only while it holds what CedarLoom left there.
const addTargets = (files: Files, part: Of<"files">, found: Found[], written: Written): void => {
  for (const { target, path, content } of found) {
    const kept = part.onlyIfAbsent === true && existsSync(path);
    if (!kept) {
      const mode = targetClass(target, content) === "executable" ? { mode: 0o755 } : {};
      files.wanted.set(path, { content, ...mode });
    }
    if (!part.commit && (!kept || hashOf(path) === written.get(path))) files.excluded.push(path);
  }
};

// The approval line of a part whose targets run as programs or configure tools, by class (owner, hub issue 130).
const approval = (part: string, title: string, project: string, found: Found[]): Finding | undefined => {
  const of = (kind: string) =>
    found.filter(({ target, content }) => targetClass(target, content) === kind).map(({ target }) => target);
  const [programs, configs] = [of("executable"), of("configuration")];
  if (programs.length + configs.length === 0) return undefined;
  return { code: "profile.target-approval", params: { part, title, project, programs, configs } };
};

const filesOf = (given: Given, written: Written) => {
  const { resolved, project, approved } = given;
  const files: Files = { wanted: new Map(), stale: [], excluded: [], held: new Set(), findings: [] };
  for (const [id, part] of Object.entries(resolved.profile.project)) {
    if (part.type !== "files") continue;
    if (!resolved.on.has(`project.${id}`)) {
      files.stale.push(...Object.keys(part.files).map((target) => onDisk(join(project, ...target.split("/")))));
      continue;
    }
    const found = filesPart(given, id, part);
    if (!found.ok) return found;
    const waits = approval(`project.${id}`, part.title, project, found.value);
    // An approved part's files in place need no new approval.
    const inPlace = found.value.every(({ path, content }) => hashOf(path) === sha256(content));
    if (waits === undefined || approved.has(`project.${id}`) || inPlace) {
      addTargets(files, part, found.value, written);
      continue;
    }
    files.findings.push(waits);
    files.held.add(`project.${id}`);
  }
  return { ok: true as const, value: files };
};

// The exclude file Git reads for a repository whose `.git` is in `root`: in its common Git folder, also from a linked
// worktree, whose `.git` file names its own folder; null when `root` holds no `.git`. Each file is read as it is, never
// checked first, so nothing changes between a check and its read.
const excludeAt = (root: string): string | null => {
  const dotGit = join(root, ".git");
  let text: string;
  try {
    text = readFileSync(dotGit, "utf8");
  } catch (error) {
    // A `.git` folder, or a link to one, cannot be read as a file.
    return errorCode(error) === "EISDIR" ? join(dotGit, "info", "exclude") : null;
  }
  const gitdir = /^gitdir: (.+)$/m.exec(text)?.[1]?.trim();
  if (gitdir === undefined) return null;
  const folder = resolve(root, gitdir);
  const common = textFile(join(folder, "commondir"));
  const shared = common.ok && common.value !== null ? resolve(folder, common.value.trim()) : folder;
  return join(shared, "info", "exclude");
};

// The repository a folder lies in, the folder's own or a parent's, with its exclude file; null outside Git.
const repositoryOf = (project: string): { root: string; exclude: string } | null => {
  for (let root = project; ; root = dirname(root)) {
    const exclude = excludeAt(root);
    if (exclude !== null) return { root, exclude };
    if (dirname(root) === root) return null;
  }
};

// The project's Git exclude block with its machine-local files, each anchored at its path from the repository's root,
// its glob characters escaped.
const excludeWrites = (project: string, paths: string[]): Result<Operation[]>[] => {
  const repository = repositoryOf(project);
  if (repository === null) return [];
  const anchor = (path: string) => `/${relative(repository.root, path).split(sep).join("/")}`;
  const lines = paths.map((path) => anchor(path).replaceAll(/[*?[\\]/g, "\\$&"));
  const body = lines.length === 0 ? null : `${lines.join("\n")}\n`;
  return [blockWrite(repository.exclude, excludeMarkers(anchor(project)), body)];
};

// AGENTS.md's block: the manual's rules, then the default tier when one is set.
const agentsBody = (context: Context): Result<string | null> => {
  const rules = rulesOf(context, "manual");
  if (!rules.ok) return rules;
  const tier = partsOn(context.resolved, "tier").at(-1)?.[1].tier ?? null;
  const lines = [...rules.value, ...(tier === null ? [] : [`Default tier: ${tier}\n`])];
  return { ok: true, value: lines.length === 0 ? null : lines.join("\n") };
};

// CLAUDE.local.md's block: the machine-local rules, then `@AGENTS.md` when CLAUDE.md does not import it.
const localBody = (context: Context, imported: boolean): Result<string | null> => {
  const rules = rulesOf(context, "local-manual");
  if (!rules.ok || rules.value.length === 0) return rules.ok ? { ok: true, value: null } : rules;
  return { ok: true, value: [...rules.value, ...(imported ? [] : ["@AGENTS.md\n"])].join("\n") };
};

// Whether a CLAUDE.md brings in AGENTS.md: it imports it, or it is AGENTS.md through a link either way.
const imports = (project: string, text: string): boolean =>
  /^@(?:\.\/)?AGENTS\.md[ \t]*$/m.test(text) ||
  onDisk(join(project, "CLAUDE.md")) === onDisk(join(project, "AGENTS.md"));

// The project's CLAUDE.md: the owner's, or one to make with only `@AGENTS.md` when there is none (D31); and whether it
// brings in AGENTS.md.
const claudeOf = ({ resolved }: Context, project: string) => {
  const path = join(project, "CLAUDE.md");
  const text = textFile(path);
  if (!text.ok) return text;
  const create = text.value === null && partsOn(resolved, "manual").some(([, part]) => part.claudeImport);
  const imported = create || (text.value !== null && imports(project, text.value));
  return { ok: true as const, value: { path, owners: text.value !== null, create, imported } };
};

// The manual's writes: its two blocks, and the CLAUDE.md to make. An owner's CLAUDE.md that does not import AGENTS.md
// is reported when no local block does, as Claude Code reads AGENTS.md by itself only without one
// (https://code.claude.com/docs/en/memory#agents-md).
const manualWrites = (context: Context, project: string) => {
  const claude = claudeOf(context, project);
  if (!claude.ok) return claude;
  const { path, owners, create, imported } = claude.value;
  const agents = agentsBody(context);
  if (!agents.ok) return agents;
  const local = localBody(context, imported);
  if (!local.ok) return local;
  const writes = [
    blockWrite(join(project, "AGENTS.md"), MARKDOWN, agents.value),
    blockWrite(join(project, "CLAUDE.local.md"), MARKDOWN, local.value),
  ];
  const created: Operation[] = create ? [{ kind: "write", path, before: null, content: "@AGENTS.md\n" }] : [];
  const unread = owners && !imported && agents.value !== null && local.value === null;
  const findings: Finding[] = unread ? [{ code: "profile.agents-unread", params: { path } }] : [];
  return { ok: true as const, value: { writes, created, findings, local: local.value !== null } };
};

// The settings parts merged into the committed `.claude/settings.json` or the local `.claude/settings.local.json` by
// `commit`, and the plugin parts `approved` names into the local one, the only one Claude Code downloads a plugin from;
// each other plugin part that would change it waits for its approval by name. Git ignores the local file while a part
// that writes it is on, also once its plugins are in place and need no new approval.
const settingsWrites = ({ resolved, project, approved }: Given) => {
  const sets = (commit: boolean) =>
    partsOn(resolved, "settings").flatMap(([, part]) => (part.commit === commit ? [part.set] : []));
  const plugins = partsOn(resolved, "plugin");
  const allowed = plugins.filter(([id]) => approved.has(`project.${id}`)).map(([, plugin]) => plugin);
  const [shared, local] = [sets(true), sets(false)];
  const operations: Operation[] = [];
  if (shared.length > 0) {
    const write = fileWrite(join(project, ".claude", "settings.json"), (json) => mergeSets(json, shared));
    if (!write.ok) return write;
    operations.push(...write.value.operations);
  }
  const none = { operations, findings: [], local: false };
  if (local.length + plugins.length === 0) return { ok: true as const, value: none };
  const path = join(project, ".claude", "settings.local.json");
  const write = fileWrite(path, (json) => withPlugins(mergeSets(json, local), allowed));
  if (!write.ok) return write;
  const others = plugins.filter(([id]) => !approved.has(`project.${id}`));
  const findings = waiting({ level: "project", project }, others, write.value.merged);
  return {
    ok: true as const,
    value: { operations: [...operations, ...write.value.operations], findings, local: true },
  };
};

// The owned files of a project's plan: the files parts' targets, and the packs' skills in `.claude/skills/`.
const ownedOf = (given: Given, files: Files, written: Written) => {
  const { resolved, project, fetched } = given;
  const skills = skillFiles(resolved, join(project, ".claude"), { fetched, written, level: "project" });
  if (!skills.ok) return skills;
  const wanted = new Map([...files.wanted, ...skills.value.wanted]);
  return ownedFiles(wanted, [...files.stale, ...skills.value.stale], written);
};

// The files Git is to ignore: CLAUDE.local.md and the local settings while CedarLoom writes into them, and the local
// targets of the files parts CedarLoom writes or holds. A target the owner changed is theirs, so Git keeps showing it.
const localPaths = (project: string, files: Files, owned: LevelPlan, local: { manual: boolean; settings: boolean }) => {
  const theirs = new Set(
    owned.findings.flatMap((finding) => (finding.code === "profile.owner-changed" ? [finding.params.path] : [])),
  );
  return [
    ...(local.manual ? [onDisk(join(project, "CLAUDE.local.md"))] : []),
    ...(local.settings ? [onDisk(join(project, ".claude", "settings.local.json"))] : []),
    ...files.excluded.filter((path) => !theirs.has(path)),
  ];
};

// The plan, unless a link leads the `.claude` folder it writes into outside the project, where its settings or skills
// would land elsewhere, such as in a user's own Claude Code home.
const unlinked = (project: string, plan: LevelPlan): Result<LevelPlan> => {
  const folder = join(project, ".claude");
  const into = plan.operations.some((operation) => "path" in operation && operation.path.startsWith(folder + sep));
  if (!into || within(folder, project)) return { ok: true, value: plan };
  return refuse({
    code: "profile.target-linked",
    params: { part: "project", target: ".claude", path: onDisk(folder) },
  });
};

/**
 * The project level for one folder: the manual's marked blocks, each files part's targets (an executable or
 * configuration one only when `approved` names its part), the settings and the approved plugins merged into the
 * project's settings files, the packs' skills, and the Git exclude block for the machine-local files. `written` holds
 * what CedarLoom last left at each path of the project (the run store's `written`).
 */
export const planProject = (
  resolved: Resolved,
  project: string,
  written: Written,
  { approved = new Set<string>(), fetched = new Map() }: { approved?: ReadonlySet<string>; fetched?: Fetched } = {},
): Result<LevelPlan> => {
  const unknown = unknownApprovals(resolved, approved, "project", ["files", "plugin"]);
  if (unknown.length > 0) return { ok: true, value: { operations: [], findings: unknown } };
  const given = { resolved, project, fetched, approved };
  const files = filesOf(given, written);
  if (!files.ok) return files;
  const manual = manualWrites({ resolved, fetched, held: files.value.held }, project);
  if (!manual.ok) return manual;
  const settings = settingsWrites(given);
  if (!settings.ok) return settings;
  const owned = ownedOf(given, files.value, written);
  if (!owned.ok) return owned;
  const local = { manual: manual.value.local, settings: settings.value.local };
  const writes = [
    ...manual.value.writes,
    ...excludeWrites(project, localPaths(project, files.value, owned.value, local)),
  ];
  const failed = writes.find((write) => !write.ok);
  if (failed !== undefined) return failed;
  const operations = [
    ...writes.flatMap((write) => (write.ok ? write.value : [])),
    ...manual.value.created,
    ...settings.value.operations,
    ...owned.value.operations,
  ];
  const findings = [files.value, manual.value, settings.value, owned.value].flatMap((each) => each.findings);
  return unlinked(project, { operations, findings });
};
