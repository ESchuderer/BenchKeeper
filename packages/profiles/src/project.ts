import { isUtf8 } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  FILES_RECORD,
  type Finding,
  type Operation,
  type Result,
  sealedTarget,
  targetClass,
} from "@cedarloom/contracts";
import { errorCode } from "@cedarloom/engine";
import { sha256 } from "@cedarloom/ledger";
import { fileWrite, mergeSets, onDisk, textOf, unknownApprovals, waiting, withPlugins, within } from "./machine.ts";
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

// A target's path on disk; refused when a link leads it outside the project, into its Git folder or onto a file only
// its own parts write, which the profile's portable paths cannot name but a link can reach.
const realTarget = (project: string, part: string, target: string): Result<string> => {
  const path = onDisk(join(project, ...target.split("/")));
  if (!outside(project, path) && !sealedTarget(relative(project, path).split(sep).join("/")))
    return { ok: true, value: path };
  return refuse({ code: "profile.target-linked", params: { part, target, path } });
};

// A project's plan: the composed profile, the project and its `.claude` folder as the disk names them, the fetched
// folders, the folders the dev container parts' Templates wrote, by part id, and the parts approved by name.
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

// A caller of the reusable workflow of its name at the bound commit, with read access only, on each pull request and
// merge queue entry, which every change to the default branch passes, whatever its name
// (https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows).
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
// Dependabot's version updates of the workflows' pins, each once the release is the cooldown's days old
// (https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference#cooldown-).
// The bound gates repository is ignored, so the binding stays the gates' one source and they move only by a new one.
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

// A dev container part's files where the project has none: what its Template wrote as the dev container, and nothing
// else it ships. Before the part's approval its Template is not applied, so the approval line names the folder.
const containerTexts = ({ project, templates, approved }: Given, id: string): Result<[string, string][]> => {
  const folder = templates.get(id);
  if (hasContainer(project) || (folder === undefined && approved.has(`project.${id}`))) return { ok: true, value: [] };
  if (folder === undefined) return { ok: true, value: [[".devcontainer/", ""]] };
  const files = folder.files.filter(({ path }) => path === ".devcontainer.json" || path.startsWith(".devcontainer/"));
  const binary = files.find(({ content }) => !isUtf8(content));
  if (binary !== undefined) return refuse({ code: "apply.not-text", params: { path: binary.path } });
  return { ok: true, value: files.map(({ path, content }): [string, string] => [path, content.toString("utf8")]) };
};

// A part's targets and texts, and how it keeps them: a files part's from its texts, a gates part's from this machine's
// gate source, a dev container's from what its Template wrote into `.devcontainer/`, an existing file left as it is.
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

// A part that is on and approved: each target it writes now, and those Git is to ignore. An `onlyIfAbsent` target
// that is there stays as it is, ignored only while it holds what CedarLoom left there.
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

// Where a part's code comes from, for its approval line: the gates' bound workflows, or the dev container's Template
// and Features; none for a files part, whose texts come from the profile's packs.
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
// each other plugin part that would change it waits for its approval by name, and is held back with the parts that
// require it. Git ignores the local file while a part that writes it is on, also once its plugins are in place.
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

// The owned files of a project's plan: the files parts' targets, and the packs' skills in `.claude/skills/`. A files
// part's target wins over a pack's file at its path, and nothing either wants is stale.
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
  const held = newer.map((params): Finding => ({ code: "profile.newer-pack", params }));
  return { ok: true as const, value: { ...plan.value, findings: [...plan.value.findings, ...held], wanted: writing } };
};

// The files Git is to ignore: CLAUDE.local.md and the local settings while CedarLoom writes into them, and the local
// targets of the files parts CedarLoom writes or holds. A target the owner changed is theirs, so Git keeps showing it.
const localPaths = (project: string, files: Files, owned: LevelPlan, local: { manual: boolean; settings: boolean }) => {
  const theirs = ownerChanged(owned);
  return [
    ...(local.manual ? [onDisk(join(project, "CLAUDE.local.md"))] : []),
    ...(local.settings ? [onDisk(join(project, ".claude", "settings.local.json"))] : []),
    ...files.excluded.filter((path) => !theirs.has(path)),
  ];
};

// The plan, unless a link leads one of its paths in `.claude` outside the project, into its Git folder or onto a sealed
// name (Claude Code's settings, an MCP list, the manual's files), where a skill's file would land elsewhere, such as in
// a user's Claude Code home, Git's hooks or the committed settings.
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

// The settings writes, then the manual's.
const settingsAndManual = (given: Given) => {
  const settings = settingsWrites(given);
  if (!settings.ok) return settings;
  const manual = manualWrites({ resolved: given.resolved, fetched: given.fetched }, given.project);
  return manual.ok ? { ok: true as const, value: { settings: settings.value, manual: manual.value } } : manual;
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

// The parts that are on, less every part that requires one held back, at any depth, as such a part would rely on what
// is not there; the held parts stay on, so they keep their approval lines.
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

// The plan's input with the parts held back for their approval (files parts with a target that may run or configure
// a tool, plugin parts) holding back every part that requires them.
const heldOf = (given: Given, written: Written): Result<Given> => {
  const files = filesOf(given, written);
  if (!files.ok) return files;
  const settings = settingsWrites(given);
  if (!settings.ok) return settings;
  const held = new Set([...files.value.held, ...settings.value.held]);
  return { ok: true, value: { ...given, resolved: unheld(given.resolved, held) } };
};

// The project's committed record of the files CedarLoom wrote there; a link that leads it outside the project or into
// its Git folder stops the plan, as the record would be read and written there.
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
 * settings and the approved plugins merged into the project's settings files; the packs' skills; and the Git exclude
 * block for the machine-local files. `templates` holds what each dev container part's Template wrote, and `written`
 * what CedarLoom last left at each path of the project (the run store's `written`).
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
  const unknown = unknownApprovals(resolved, approved, "project", ["files", "plugin", "gates", "devcontainer"]);
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
  const writes = settingsAndManual(given);
  if (!writes.ok) return writes;
  const { settings, manual } = writes.value;
  const owned = ownedOf(given, files.value, { written, record: at.value.record });
  if (!owned.ok) return owned;
  const local = { manual: manual.local, settings: settings.local };
  const blocks = blockWrites(project, manual, localPaths(project, files.value, owned.value, local));
  if (!blocks.ok) return blocks;
  const excluded = new Set(files.value.excluded);
  const committed = new Map([...owned.value.wanted].filter(([path]) => !excluded.has(path)));
  const record = recordWrite({ project, path: at.value.path }, at.value.record, { committed, plan: owned.value });
  const operations = [...blocks.value, ...settings.operations, ...owned.value.operations, ...record];
  const unbound = resolved.unbound
    .filter((part) => part.startsWith("project."))
    .map((part): Finding => ({ code: "profile.binding-waiting", params: { part, binding: "gates" } }));
  const findings = [...unbound, ...[files.value, manual, settings, owned.value].flatMap((each) => each.findings)];
  return unlinked(given, { operations, findings });
};
