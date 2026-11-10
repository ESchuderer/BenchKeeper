import { isUtf8 } from "node:buffer";
import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  FILES_RECORD,
  type Finding,
  type Operation,
  type Result,
  sealedTarget,
  targetClass,
} from "@cedarloom/contracts";
import { repositoryOf } from "@cedarloom/git";
import { sha256 } from "@cedarloom/ledger";
import { fileWrite, mergeSets, onDisk, textOf, unknownApprovals, waiting, withPlugins, within } from "./machine.ts";
import { mcpWrites } from "./mcp.ts";
import { type LevelPlan, ownedFiles, type Wanted } from "./owned.ts";
import {
  type FilesRecord,
  hashOrNull,
  newerRecorded,
  ownerChanged,
  recordOf,
  recordWrite,
  withRecord,
} from "./record.ts";
import { type Folder, packVersion, type Resolved, textFile } from "./resolve.ts";
import { type Fetched, packFolder, skillFiles } from "./skills.ts";

type Part = Resolved["profile"]["project"][string];
type Of<T extends Part["type"]> = Extract<Part, { type: T }>;
type Markers = readonly [string, string];

const refuse = (finding: Finding): Result<never> => ({ ok: false, finding });

const MARKDOWN: Markers = ["<!-- cedarloom start -->", "<!-- cedarloom end -->"];
// One block per project in its repository's exclude file, named by the project's path from the repository's root.
const excludeMarkers = (anchor: string): Markers => [`# cedarloom start ${anchor}`, `# cedarloom end ${anchor}`];

// Where each line holding only the marker starts (a CR before its break allowed); a marker inside a line is text.
const markerLines = (text: string, marker: string): number[] => {
  const found: number[] = [];
  let at = 0;
  for (const line of text.split("\n")) {
    if (line === marker || line === `${marker}\r`) found.push(at);
    at += line.length + 1;
  }
  return found;
};

// CedarLoom's block: none without one; null when its markers are broken, where a write must not guess the owner's text.
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

// The rules of the parts of one type that are on, in profile order, each ending in one line break.
type Context = { resolved: Resolved; fetched: Fetched };
type Written = ReadonlyMap<string, string | null>;
const rulesOf = ({ resolved, fetched }: Context, type: "manual" | "local-manual"): Result<string[]> => {
  const texts: string[] = [];
  for (const [id, part] of partsOn(resolved, type)) {
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
type Found = { target: string; path: string; content: string; pack?: string };
// Each target with its text, and the pack the text came from as `id@version`.
type Texts = [target: string, content: string, pack?: string][];

// Whether a path, through its links, leaves the project or lies in its Git folder.
const outside = (project: string, path: string): boolean => {
  const real = onDisk(path);
  const git = relative(project, real)
    .split(sep)
    .some((segment) => segment.toLowerCase() === ".git");
  return git || !within(real, project);
};

// A target's path on disk, refused through a link: docs/agents/cedarloom-rationale.md#project-links
const realTarget = (project: string, part: string, target: string): Result<string> => {
  const path = onDisk(join(project, ...target.split("/")));
  if (!outside(project, path) && !sealedTarget(relative(project, path).split(sep).join("/")))
    return { ok: true, value: path };
  return refuse({ code: "profile.target-linked", params: { part, target, path } });
};

type Given = {
  resolved: Resolved;
  project: string;
  claude: string;
  fetched: Fetched;
  templates: ReadonlyMap<string, Folder>;
  approved: ReadonlySet<string>;
};

// The parts that write whole files, and how each keeps them: committed or ignored by Git, an existing file left as is.
type Whole = Of<"files"> | Of<"gates"> | Of<"devcontainer">;
type Keeping = { commit: boolean; onlyIfAbsent: boolean };
const isWhole = (part: Part): part is Whole => ["files", "gates", "devcontainer"].includes(part.type);

const gatePath = (caller: string): string => `.github/workflows/${caller}.yml`;
const DEPENDABOT = ".github/dependabot.yml";
// The targets a part names before its texts are read; a dev container's are known once its Template is applied.
const targetNames = (part: Whole): string[] => {
  if (part.type === "files") return Object.keys(part.files);
  return part.type === "gates" ? [...part.callers.map(gatePath), DEPENDABOT] : [];
};

// A caller of the bound reusable workflow: docs/agents/cedarloom-rationale.md#gates
const callerText = (name: string, repository: string, commit: string): string => `name: ${name}
on:
  pull_request:
  merge_group:
permissions: {}
jobs:
  ${name}:
    uses: ${repository}/.github/workflows/${name}.yml@${commit}
    permissions:
      contents: read
`;
// Dependabot updates the workflows' pins after the cooldown: docs/agents/cedarloom-rationale.md#gates
const dependabotText = (days: number, repository: string): string => `version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    cooldown:
      default-days: ${days}
    ignore:
      - dependency-name: "${repository}"
      - dependency-name: "${repository}/*"
`;

// A files part's targets with their texts.
const filesTexts = ({ resolved, fetched }: Given, id: string, part: Of<"files">): Result<Texts> => {
  const texts: Texts = [];
  for (const [target, text] of Object.entries(part.files)) {
    const pointer = `/project/${id}/files/${target.replaceAll("~", "~0").replaceAll("/", "~1")}`;
    const read = textOf(text, { kind: "template", pointer }, resolved, fetched);
    if (!read.ok) return read;
    const from = "pack" in text ? packVersion(text.pack, packFolder(resolved, text.pack, fetched)) : undefined;
    texts.push(from === undefined ? [target, read.value] : [target, read.value, from]);
  }
  return { ok: true, value: texts };
};

/** Whether a project has a dev container: a folder, or a file at its root (https://containers.dev/implementors/spec/). */
export const hasContainer = (project: string): boolean =>
  existsSync(join(project, ".devcontainer")) || existsSync(join(project, ".devcontainer.json"));

// A dev container part's files where the project has none: its Template's output; before approval, none are applied.
const containerTexts = ({ project, templates, approved }: Given, id: string): Result<[string, string][]> => {
  const folder = templates.get(id);
  if (hasContainer(project) || (folder === undefined && approved.has(`project.${id}`))) return { ok: true, value: [] };
  if (folder === undefined) return { ok: true, value: [[".devcontainer/", ""]] };
  const files = folder.files.filter(({ path }) => path === ".devcontainer.json" || path.startsWith(".devcontainer/"));
  const binary = files.find(({ content }) => !isUtf8(content));
  if (binary !== undefined) return refuse({ code: "apply.not-text", params: { path: binary.path } });
  return { ok: true, value: files.map(({ path, content }): [string, string] => [path, content.toString("utf8")]) };
};

const textsOf = (given: Given, id: string, part: Whole): Result<{ texts: Texts; keeping: Keeping }> => {
  if (part.type === "files") {
    const texts = filesTexts(given, id, part);
    const keeping = { commit: part.commit, onlyIfAbsent: part.onlyIfAbsent === true };
    return texts.ok ? { ok: true, value: { texts: texts.value, keeping } } : texts;
  }
  if (part.type === "devcontainer") {
    const texts = containerTexts(given, id);
    return texts.ok
      ? { ok: true, value: { texts: texts.value, keeping: { commit: true, onlyIfAbsent: true } } }
      : texts;
  }
  const { gates } = given.resolved;
  if (gates === undefined)
    return refuse({ code: "profile.binding-missing", params: { part: `project.${id}`, binding: "gates" } });
  const [repository = "", commit = ""] = gates.split("@");
  const callers = part.callers.map((name): [string, string] => [gatePath(name), callerText(name, repository, commit)]);
  const texts: [string, string][] = [...callers, [DEPENDABOT, dependabotText(part.dependabotCooldownDays, repository)]];
  return { ok: true, value: { texts, keeping: { commit: true, onlyIfAbsent: false } } };
};

// A part's targets with their texts and their paths on disk, and how it keeps them.
const foundOf = (given: Given, id: string, part: Whole): Result<{ found: Found[]; keeping: Keeping }> => {
  const read = textsOf(given, id, part);
  if (!read.ok) return read;
  const found: Found[] = [];
  for (const [target, content, pack] of read.value.texts) {
    const path = realTarget(given.project, `project.${id}`, target);
    if (!path.ok) return path;
    found.push({ target, path: path.value, content, ...(pack === undefined ? {} : { pack }) });
  }
  return { ok: true, value: { found, keeping: read.value.keeping } };
};

// An approved part's targets and those Git ignores; a present `onlyIfAbsent` target stays, ignored while it is ours.
const addTargets = (files: Files, keeping: Keeping, found: Found[], written: Written): void => {
  for (const { target, path, content, pack } of found) {
    const kept = keeping.onlyIfAbsent && existsSync(path);
    if (!kept) {
      const mode = targetClass(target, content) === "executable" ? { mode: 0o755 } : {};
      files.wanted.set(path, { content, ...mode, ...(pack === undefined ? {} : { pack }) });
    }
    if (!keeping.commit && (!kept || hashOrNull(path) === written.get(path))) files.excluded.push(path);
  }
};

// The approval line of a part whose targets run as programs or configure tools, by class (owner, hub issue 130).
type Approval = { part: string; title: string; project: string; source: string | null };
const approval = (line: Approval, found: Found[]): Finding | undefined => {
  const of = (kind: string) =>
    found.filter(({ target, content }) => targetClass(target, content) === kind).map(({ target }) => target);
  const [programs, configs] = [of("executable"), of("configuration")];
  if (programs.length + configs.length === 0) return undefined;
  return { code: "profile.target-approval", params: { ...line, programs, configs } };
};

// Where a part's code comes from, for its approval line: the gates' workflows or its Template and Features.
const sourceOf = ({ resolved }: Given, part: Whole): string | null => {
  if (part.type === "gates") return resolved.gates ?? null;
  if (part.type === "files") return null;
  const features = Object.keys(part.features ?? {});
  return features.length === 0 ? part.template : `${part.template} with the Features ${features.join(", ")}`;
};

const filesOf = (given: Given, written: Written) => {
  const { resolved, project, approved } = given;
  const files: Files = { wanted: new Map(), stale: [], excluded: [], held: new Set(), findings: [] };
  for (const [id, part] of Object.entries(resolved.profile.project)) {
    if (!isWhole(part)) continue;
    if (!resolved.on.has(`project.${id}`)) {
      files.stale.push(...targetNames(part).map((target) => onDisk(join(project, ...target.split("/")))));
      continue;
    }
    const read = foundOf(given, id, part);
    if (!read.ok) return read;
    const { found, keeping } = read.value;
    const twice = found.find(({ path }) => files.wanted.has(path));
    if (twice !== undefined)
      return refuse({ code: "profile.target-twice", params: { part: `project.${id}`, target: twice.target } });
    const line = { part: `project.${id}`, title: part.title, project, source: sourceOf(given, part) };
    const waits = approval(line, found);
    // An approved part's files in place need no new approval.
    const inPlace = found.every(({ path, content }) => hashOrNull(path) === sha256(content));
    if (waits === undefined || approved.has(`project.${id}`) || inPlace) {
      addTargets(files, keeping, found, written);
      continue;
    }
    files.findings.push(waits);
    files.held.add(`project.${id}`);
  }
  return { ok: true as const, value: files };
};

// Anchored and with glob characters escaped, so each line matches only its own file.
const excludeWrites = (project: string, paths: string[]): Result<Operation[]>[] => {
  const repository = repositoryOf(project);
  if (repository === null) return [];
  const exclude = join(repository.common, "info", "exclude");
  const anchor = (path: string) => `/${relative(repository.root, path).split(sep).join("/")}`;
  const lines = paths.map((path) => anchor(path).replaceAll(/[*?[\\]/g, "\\$&"));
  const body = lines.length === 0 ? null : `${lines.join("\n")}\n`;
  return [blockWrite(exclude, excludeMarkers(anchor(project)), body)];
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

// The project's CLAUDE.md: the owner's, or a new one with only `@AGENTS.md` (D31); and whether it brings in AGENTS.md.
const claudeOf = ({ resolved }: Context, project: string) => {
  const path = join(project, "CLAUDE.md");
  const text = textFile(path);
  if (!text.ok) return text;
  const create = text.value === null && partsOn(resolved, "manual").some(([, part]) => part.claudeImport);
  const imported = create || (text.value !== null && imports(project, text.value));
  return { ok: true as const, value: { path, owners: text.value !== null, create, imported } };
};

// An owner's CLAUDE.md without `@AGENTS.md` is reported: docs/agents/cedarloom-rationale.md#manual
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

// Settings and plugin parts into the settings files: docs/agents/cedarloom-rationale.md#settings-writes
const settingsWrites = ({ resolved, project, claude, approved }: Given) => {
  const sets = (commit: boolean) =>
    partsOn(resolved, "settings").flatMap(([, part]) => (part.commit === commit ? [part.set] : []));
  const plugins = partsOn(resolved, "plugin");
  const allowed = plugins.filter(([id]) => approved.has(`project.${id}`)).map(([, plugin]) => plugin);
  const [shared, local] = [sets(true), sets(false)];
  const operations: Operation[] = [];
  if (shared.length > 0) {
    const write = fileWrite(join(claude, "settings.json"), (json) => mergeSets(json, shared));
    if (!write.ok) return write;
    operations.push(...write.value.operations);
  }
  const none = { operations, findings: [], held: [], local: false };
  if (local.length + plugins.length === 0) return { ok: true as const, value: none };
  const write = fileWrite(join(claude, "settings.local.json"), (json) => withPlugins(mergeSets(json, local), allowed));
  if (!write.ok) return write;
  const others = plugins.filter(([id]) => !approved.has(`project.${id}`));
  const findings = waiting({ level: "project", project }, others, write.value.merged);
  const held = findings.flatMap((finding) => (finding.code === "profile.approval-needed" ? [finding.params.part] : []));
  const value = { operations: [...operations, ...write.value.operations], findings, held, local: true };
  return { ok: true as const, value };
};

// The owned files: the files parts' targets and the packs' skills; a files part's target wins over a pack's file there.
const ownedOf = (given: Given, files: Files, { written, record }: { written: Written; record: FilesRecord }) => {
  const skills = skillFiles(given.resolved, given.claude, { fetched: given.fetched, written, level: "project" });
  if (!skills.ok) return skills;
  const wanted = new Map([...skills.value.wanted, ...files.wanted]);
  // A files target in the skills folder is the files part's stale path and the skills' too: it goes once.
  const stale = [...new Set([...files.stale, ...skills.value.stale])].filter((path) => !wanted.has(path));
  const newer = newerRecorded(record, wanted);
  const writing = new Map([...wanted].filter(([path]) => !newer.some((each) => each.path === path)));
  // The record vouches only for files this plan writes: one another clone's profile wants is never removed by it.
  const known = withRecord(written, new Map([...record].filter(([path]) => writing.has(path))));
  const plan = ownedFiles(writing, stale, known);
  if (!plan.ok) return plan;
  // Held all the same, so this clone never tags them back; reported only where the file differs from the text here.
  const held = newer
    .filter(({ path }) => hashOrNull(path) !== sha256(wanted.get(path)?.content ?? ""))
    .map((params): Finding => ({ code: "profile.newer-pack", params }));
  return { ok: true as const, value: { ...plan.value, findings: [...plan.value.findings, ...held], wanted: writing } };
};

// A target the owner changed is theirs, so Git keeps showing it; the local manual and settings are ignored while written.
const localPaths = (project: string, files: Files, owned: LevelPlan, local: { manual: boolean; settings: boolean }) => {
  const theirs = ownerChanged(owned);
  return [
    ...(local.manual ? [onDisk(join(project, "CLAUDE.local.md"))] : []),
    ...(local.settings ? [onDisk(join(project, ".claude", "settings.local.json"))] : []),
    ...files.excluded.filter((path) => !theirs.has(path)),
  ];
};

// The plan, unless a link leads a `.claude` path astray: docs/agents/cedarloom-rationale.md#project-links
const unlinked = ({ project, claude }: Given, plan: LevelPlan): Result<LevelPlan> => {
  // The settings part's own files; any other path that a link leads onto a sealed name would bring hooks or servers.
  const own = new Set(["settings.json", "settings.local.json"].map((name) => join(claude, name)));
  const sealed = (path: string) => !own.has(path) && sealedTarget(relative(project, onDisk(path)).split(sep).join("/"));
  const linked = plan.operations
    .flatMap((operation) => ("path" in operation && operation.path.startsWith(claude + sep) ? [operation.path] : []))
    .find((path) => outside(project, path) || sealed(path));
  if (linked === undefined) return { ok: true, value: plan };
  const target = `.claude/${relative(claude, linked).split(sep).join("/")}`;
  return refuse({ code: "profile.target-linked", params: { part: "project", target, path: onDisk(linked) } });
};

// The settings writes, the manual's, then the MCP servers'.
const configWrites = (given: Given) => {
  const settings = settingsWrites(given);
  if (!settings.ok) return settings;
  const manual = manualWrites({ resolved: given.resolved, fetched: given.fetched }, given.project);
  if (!manual.ok) return manual;
  const mcp = mcpWrites(given);
  return mcp.ok
    ? { ok: true as const, value: { settings: settings.value, manual: manual.value, mcp: mcp.value } }
    : mcp;
};

// The manual's blocks and the CLAUDE.md to make, and the Git exclude block with these machine-local files.
const blockWrites = (
  project: string,
  manual: { writes: Result<Operation[]>[]; created: Operation[] },
  local: string[],
): Result<Operation[]> => {
  const writes = [...manual.writes, ...excludeWrites(project, local)];
  const failed = writes.find((write) => !write.ok);
  if (failed !== undefined) return failed;
  return { ok: true, value: [...writes.flatMap((write) => (write.ok ? write.value : [])), ...manual.created] };
};

// The on parts minus each needing a held-back part, at any depth; held parts stay on to keep their approval lines.
const unheld = (resolved: Resolved, held: ReadonlySet<string>): Resolved => {
  const on = new Set([...resolved.on].filter((key) => !held.has(key)));
  const parts = Object.entries(resolved.profile.project).map(([id, part]) => ({ key: `project.${id}`, part }));
  for (let size = -1; size !== on.size; ) {
    size = on.size;
    for (const { key, part } of parts)
      if ((part.requires ?? []).some((each) => resolved.on.has(each) && !on.has(each))) on.delete(key);
  }
  return { ...resolved, on: new Set([...on, ...held]) };
};

// The input with the parts held for approval (risky targets, plugins, MCP servers) holding back each part that needs them.
const heldOf = (given: Given, written: Written): Result<Given> => {
  const files = filesOf(given, written);
  if (!files.ok) return files;
  const settings = settingsWrites(given);
  if (!settings.ok) return settings;
  const mcp = mcpWrites(given);
  if (!mcp.ok) return mcp;
  const held = new Set([...files.value.held, ...settings.value.held, ...mcp.value.held]);
  return { ok: true, value: { ...given, resolved: unheld(given.resolved, held) } };
};

// The project's record of the files CedarLoom wrote: docs/agents/cedarloom-rationale.md#project-links
const recordAt = (project: string): Result<{ path: string; record: FilesRecord }> => {
  const path = onDisk(join(project, ...FILES_RECORD.split("/")));
  if (outside(project, path))
    return refuse({ code: "profile.target-linked", params: { part: "project", target: FILES_RECORD, path } });
  const record = recordOf(project, path);
  return record.ok ? { ok: true, value: { path, record: record.value } } : record;
};

/** What CedarLoom last left at each path of a project: the run store's `written` with the project's committed record. */
export const projectWritten = (project: string, written: Written): Result<Written> => {
  const at = recordAt(project);
  return at.ok ? { ok: true, value: withRecord(written, at.value.record) } : at;
};

/**
 * The project level for one folder: the manual's marked blocks; each files, gates and dev container part's targets (an
 * executable or configuration one only when `approved` names its part, so CI files never come with `--yes` alone); the
 * settings and the approved plugins merged into the project's settings files; the approved MCP parts' servers in
 * `.mcp.json` and the Codex config; the packs' skills; and the Git exclude block for the machine-local files.
 * `templates` holds what each dev container part's Template wrote, and `written` what CedarLoom last left at each path
 * of the project (the run store's `written`).
 */
export const planProject = (
  resolved: Resolved,
  project: string,
  written: Written,
  options: { approved?: ReadonlySet<string>; fetched?: Fetched; templates?: ReadonlyMap<string, Folder> } = {},
): Result<LevelPlan> => {
  const { approved, fetched, templates } = {
    approved: new Set<string>(),
    fetched: new Map(),
    templates: new Map(),
    ...options,
  };
  const unknown = unknownApprovals(resolved, approved, "project", ["files", "plugin", "gates", "devcontainer", "mcp"]);
  if (unknown.length > 0) return { ok: true, value: { operations: [], findings: unknown } };
  const at = recordAt(project);
  if (!at.ok) return at;
  const held = heldOf(
    { resolved, project, claude: onDisk(join(project, ".claude")), fetched, templates, approved },
    written,
  );
  if (!held.ok) return held;
  const given = held.value;
  const files = filesOf(given, written);
  if (!files.ok) return files;
  const writes = configWrites(given);
  if (!writes.ok) return writes;
  const { settings, manual, mcp } = writes.value;
  const owned = ownedOf(given, files.value, { written, record: at.value.record });
  if (!owned.ok) return owned;
  const local = { manual: manual.local, settings: settings.local };
  const blocks = blockWrites(project, manual, localPaths(project, files.value, owned.value, local));
  if (!blocks.ok) return blocks;
  const excluded = new Set(files.value.excluded);
  const committed = new Map([...owned.value.wanted].filter(([path]) => !excluded.has(path)));
  const record = recordWrite({ project, path: at.value.path }, at.value.record, { committed, plan: owned.value });
  const operations = [...blocks.value, ...settings.operations, ...mcp.operations, ...owned.value.operations, ...record];
  const unbound = resolved.unbound
    .filter((part) => part.startsWith("project."))
    .map((part): Finding => ({ code: "profile.binding-waiting", params: { part, binding: "gates" } }));
  const findings = [...unbound, ...[files.value, manual, settings, mcp, owned.value].flatMap((each) => each.findings)];
  return unlinked(given, { operations, findings });
};
