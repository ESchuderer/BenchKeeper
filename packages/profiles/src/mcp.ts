import { statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  canonicalJson,
  type Finding,
  isTree,
  type Json,
  type Operation,
  type Result,
  semver,
} from "@cedarloom/contracts";
import { sha256 } from "@cedarloom/ledger";
import { tomlEntryOf, tomlOf, tomlState, tomlTable, withoutTable, withTable } from "./codex-config.ts";
import { onDisk, readSettings } from "./machine.ts";
import type { ServersRecord } from "./record.ts";
import { type Resolved, textFile } from "./resolve.ts";

type Part = Extract<Resolved["profile"]["project"][string], { type: "mcp" }>;
type Launch = { command: string; args: string[]; variables: string[] } | { url: string; variables: string[] };
type State = "equal" | "absent" | "differs" | "stuck";
type Entries = NonNullable<ServersRecord[keyof ServersRecord]>;
// One file of servers as the plan changes it, each change checked against what the file holds by then, and the record
// of the entries CedarLoom wrote there, changed along.
type Document = {
  file: keyof ServersRecord;
  entry: (server: string, launch: Launch) => string;
  state: (server: string, launch: Launch) => State;
  /** Adds the entry, in place of the server's present one. */
  add: (server: string, launch: Launch) => void;
  /** The hash of the server's entry as the file holds it by then; undefined without one. */
  digest: (server: string) => string | undefined;
  /** Takes the server's entry out and returns its text as the file held it; null when it cannot be cut alone. */
  remove: (server: string) => string | null;
  record: Entries;
  operations: () => Result<Operation[]>;
};

const MCP_JSON = ".mcp.json";
const CODEX = ".codex/config.toml";
const refuse = (finding: Finding): Result<never> => ({ ok: false, finding });

const pinned = (name: string, version: string | undefined) => (version === undefined ? name : `${name}@${version}`);
// The project's own install from any folder in it, no `$`: docs/agents/cedarloom-rationale.md#mcp-servers
const fromInstall = (name: string): string =>
  [
    `const{join:j,dirname:u}=require("path"),{readFileSync:r,existsSync:e}=require("fs"),n=${JSON.stringify(name)},`,
    `k=n.split("/").pop();let d=process.cwd(),p;for(;;d=u(d)){try{p=JSON.parse(r(j(d,"package.json"),"utf8"))}catch{p=0}`,
    `if(Object.hasOwn(Object(p?.devDependencies),n)&&e(j(d,"node_modules",n,"package.json")))break;`,
    `if(u(d)==d||e(j(d,".git")))throw Error(n+" is not a devDependency installed here or in a parent folder of the repository")}`,
    `const m=j(d,"node_modules",n),b=JSON.parse(r(j(m,"package.json"),"utf8")).bin,`,
    `v=typeof b=="string"?[b]:Object.values(Object(b)),f=new Set(v).size==1?v[0]:Object.hasOwn(Object(b),k)?b[k]:"";`,
    `if(!f)throw Error(n+" names no bin to run");const c=require("child_process").spawn(process.execPath,[j(m,f)],{stdio:"inherit"});`,
    `for(const g of["SIGINT","SIGTERM"])process.on(g,()=>c.kill(g));c.on("exit",(x)=>process.exit(x??1))`,
  ].join("");
const launchOf = (source: Part["source"]): Launch => {
  if ("url" in source) return { url: source.url, variables: source.bearer === undefined ? [] : [source.bearer] };
  const variables = source.env ?? [];
  if ("npm" in source) return { command: "npx", args: ["-y", pinned(source.npm, source.version)], variables };
  if ("devDependency" in source) return { command: "node", args: ["-e", fromInstall(source.devDependency)], variables };
  return { command: "uvx", args: [pinned(source.pypi, source.version)], variables };
};

// Claude Code fills `${NAME}` from the session's environment (https://code.claude.com/docs/en/mcp).
const jsonEntry = (launch: Launch): Json => {
  if ("url" in launch) {
    const [bearer] = launch.variables;
    const headers = bearer === undefined ? {} : { headers: { Authorization: `Bearer \${${bearer}}` } };
    return { type: "http", url: launch.url, ...headers };
  }
  const { command, args, variables } = launch;
  const env = Object.fromEntries(variables.map((name) => [name, `\${${name}}`]));
  return { type: "stdio", command, args, ...(variables.length === 0 ? {} : { env }) };
};

const tomlEntry = (server: string, launch: Launch): string => {
  if ("url" in launch) {
    const bearer = launch.variables.map((name) => ["bearer_token_env_var", name] as const);
    return tomlTable(server, [["url", launch.url], ...bearer]);
  }
  const variables = launch.variables.length === 0 ? [] : [["env_vars", launch.variables] as const];
  return tomlTable(server, [["command", launch.command], ["args", launch.args], ...variables]);
};

const entryText = (server: string, value: Json) => `${JSON.stringify(server)}: ${JSON.stringify(value)}`;
const jsonText = (server: string, launch: Launch) => entryText(server, jsonEntry(launch));
// Reformatting, CRLF and TOML comments change no entry's hash: docs/agents/cedarloom-rationale.md#mcp-servers
const hashOf = (value: Json | undefined) => (value === undefined ? undefined : sha256(canonicalJson(value)));

// The file's own indent (a tab, or its first indented line's spaces), line ending and final break; a new or one-line
// file gets two spaces, LF and a break.
const asWritten = (json: Json, text: string | null): string => {
  const indent = /^([ \t]+)\S/m.exec(text ?? "")?.[1] ?? "  ";
  const eol = text?.includes("\r\n") ? "\r\n" : "\n";
  const end = text === null || text.endsWith("\n") ? eol : "";
  return `${JSON.stringify(json, null, indent).replaceAll("\n", eol)}${end}`;
};

const jsonFile = (path: string, record: Entries): Result<Document> => {
  const read = readSettings(path);
  if (!read.ok) return read;
  const { json, text, before } = read.value;
  const found = isTree(json) ? json["mcpServers"] : undefined;
  if (found !== undefined && !isTree(found))
    return refuse({ code: "document.unreadable", params: { path, error: "mcpServers is not an object" } });
  const servers = { ...found };
  const state = (server: string, launch: Launch): State => {
    if (!Object.hasOwn(servers, server)) return "absent";
    return isDeepStrictEqual(servers[server], jsonEntry(launch)) ? "equal" : "differs";
  };
  const operations = (): Result<Operation[]> => {
    if (canonicalJson(servers) === canonicalJson(found ?? {})) return { ok: true, value: [] };
    const content = asWritten({ ...(isTree(json) ? json : {}), mcpServers: servers }, text);
    return { ok: true, value: [{ kind: "write", path, before, content }] };
  };
  const add = (server: string, launch: Launch) => {
    servers[server] = jsonEntry(launch);
  };
  const digest = (server: string) => (Object.hasOwn(servers, server) ? hashOf(servers[server]) : undefined);
  const remove = (server: string) => {
    const value = Object.hasOwn(servers, server) ? servers[server] : undefined;
    if (value === undefined) return null;
    delete servers[server];
    return entryText(server, value);
  };
  return { ok: true, value: { file: MCP_JSON, entry: jsonText, state, add, digest, remove, record, operations } };
};

const tomlFile = (path: string, record: Entries): Result<Document> => {
  const read = textFile(path);
  if (!read.ok) return read;
  const original = read.value ?? "";
  if (tomlOf(original) === undefined)
    return refuse({ code: "document.unreadable", params: { path, error: "not TOML" } });
  let text = original;
  const state = (server: string, launch: Launch) => tomlState(text, server, tomlEntry(server, launch));
  const before = read.value === null ? null : sha256(read.value);
  const operations = (): Result<Operation[]> => ({
    ok: true,
    value: text === original ? [] : [{ kind: "write", path, before, content: text }],
  });
  // A replaced table moves to the end, as the cut takes it out where it was.
  const add = (server: string, launch: Launch) => {
    text = withTable(withoutTable(text, server)?.text ?? text, tomlEntry(server, launch), text);
  };
  const digest = (server: string) => hashOf(tomlEntryOf(text, server));
  const remove = (server: string) => {
    const cut = withoutTable(text, server);
    if (cut !== null) text = cut.text;
    return cut?.table ?? null;
  };
  return { ok: true, value: { file: CODEX, entry: tomlEntry, state, add, digest, remove, record, operations } };
};

// A file's path on disk, refused when a link leads it anywhere else: docs/agents/cedarloom-rationale.md#project-links
const opened = (project: string, target: string, open: (path: string) => Result<Document>): Result<Document> => {
  const path = onDisk(join(project, ...target.split("/")));
  if (relative(onDisk(project), path).split(sep).join("/") === target) return open(path);
  return refuse({ code: "profile.target-linked", params: { part: "project", target, path } });
};

type Context = {
  documents: Document[];
  approved: ReadonlySet<string>;
  project: string;
  codex: boolean;
  manifest: Json;
};

// A `.codex` the plan cannot read, such as a link loop or one without access, is no folder.
const isFolder = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

// Codex's config only where the project has `.codex/`; package.json read only when a part runs from its install.
const contextOf = (
  project: string,
  approved: ReadonlySet<string>,
  on: [string, Part][],
  recorded: ServersRecord,
): Result<Context> => {
  const codex = isFolder(join(project, ".codex"));
  const targets: [keyof ServersRecord, (path: string, record: Entries) => Result<Document>][] = [[MCP_JSON, jsonFile]];
  if (codex) targets.push([CODEX, tomlFile]);
  const documents: Document[] = [];
  for (const [target, open] of targets) {
    const document = opened(project, target, (path) => open(path, { ...recorded[target] }));
    // Off parts have nothing to take out of a file the plan cannot open, so it stops only a plan that adds.
    if (!document.ok && on.length > 0) return document;
    if (document.ok) documents.push(document.value);
  }
  const installed = on.some(([, part]) => "devDependency" in part.source);
  const manifest = installed ? readSettings(join(project, "package.json")) : { ok: true as const, value: { json: {} } };
  if (!manifest.ok) return manifest;
  return { ok: true, value: { documents, approved, project, codex, manifest: manifest.value.json } };
};

// Only an exact version: a range, Git or file spec runs whatever it resolves to.
const listed = (manifest: Json, name: string): boolean => {
  const dependencies = isTree(manifest) ? manifest["devDependencies"] : undefined;
  return isTree(dependencies) && semver.safeParse(dependencies[name]).success;
};

type Change = "add" | "replace";
type Approval = { key: string; part: Part; launch: Launch; entries: { file: string; change: Change; entry: string }[] };
const approvalOf = ({ project, codex }: Context, { key, part, launch, entries }: Approval): Finding => ({
  code: "profile.mcp-approval",
  params: {
    part: key,
    title: part.title,
    project,
    server: part.server,
    transport: "url" in launch ? "http" : "stdio",
    runs: "url" in launch ? launch.url : [launch.command, ...launch.args].join(" "),
    variables: launch.variables,
    entries,
    codex,
    unpinned: ("npm" in part.source || "pypi" in part.source) && part.source.version === undefined,
  },
});

// An entry CedarLoom wrote and nobody changed since; an identical one the record does not name is the owner's.
const mine = (document: Document, server: string): boolean => {
  const hash = document.digest(server);
  return hash !== undefined && document.record[server]?.sha256 === hash;
};

type Outcome = { findings: Finding[]; held: boolean };
// An on part's entry goes where it is absent, or in place of the one CedarLoom wrote, once approved by name; another
// entry of its name holds the part. A replace waits unheld, as the entry it replaces runs meanwhile.
const onPart = (context: Context, [id, part]: [string, Part]): Outcome => {
  const [key, { server, source }] = [`project.${id}`, part];
  if ("devDependency" in source && !listed(context.manifest, source.devDependency)) {
    const params = { part: key, package: source.devDependency };
    return { held: true, findings: [{ code: "profile.mcp-dependency", params }] };
  }
  const launch = launchOf(source);
  const states = context.documents.map((document) => ({ document, state: document.state(server, launch) }));
  const stuck = states.filter(
    ({ document, state }) => state === "stuck" || (state === "differs" && !mine(document, server)),
  );
  if (stuck.length > 0) {
    const findings = stuck.map(
      ({ document }): Finding => ({ code: "profile.mcp-conflict", params: { part: key, server, file: document.file } }),
    );
    return { held: true, findings };
  }
  const changes = states.flatMap(({ document, state }) =>
    state === "equal" ? [] : [{ document, change: state === "absent" ? ("add" as const) : ("replace" as const) }],
  );
  const entries = changes.map(({ document, change }) => ({
    file: document.file,
    change,
    entry: document.entry(server, launch),
  }));
  if (changes.length === 0) return { held: false, findings: [] };
  if (!context.approved.has(key)) {
    const held = changes.some(({ change }) => change === "add");
    return { held, findings: [approvalOf(context, { key, part, launch, entries })] };
  }
  for (const { document } of changes) {
    document.add(server, launch);
    const hash = document.digest(server);
    if (hash !== undefined) document.record[server] = { sha256: hash };
  }
  const findings = entries.map(
    (params): Finding => ({ code: "profile.mcp-entry", params: { part: key, server, ...params } }),
  );
  return { held: false, findings };
};

// An explicit off takes out each entry CedarLoom wrote as it wrote it; one changed since stays, said once, as the
// record hands it to the owner. An entry the record does not name is the owner's and gets no line.
const offPart = (documents: Document[], [id, { server }]: [string, Part]): Finding[] =>
  documents.flatMap((document): Finding[] => {
    if (!Object.hasOwn(document.record, server) || document.digest(server) === undefined) return [];
    const entry = mine(document, server) ? document.remove(server) : null;
    delete document.record[server];
    const params = { part: `project.${id}`, server, file: document.file };
    if (entry === null) return [{ code: "profile.mcp-kept", params }];
    return [{ code: "profile.mcp-entry", params: { ...params, change: "remove", entry } }];
  });

// The record after the plan: each opened file's entries still in it; a file the plan did not open keeps its own.
const recordAfter = (recorded: ServersRecord, documents: Document[]): ServersRecord => {
  const next = { ...recorded };
  for (const { file, record, digest } of documents) {
    const kept = Object.entries(record).filter(([server]) => digest(server) !== undefined);
    if (kept.length === 0) delete next[file];
    else next[file] = Object.fromEntries(kept);
  }
  return next;
};

/**
 * The MCP parts' servers in the project's `.mcp.json`, and in `.codex/config.toml` where the project has `.codex/`:
 * each on part's entry once `approved` names it, in place of the one CedarLoom wrote when that is unchanged; the entry
 * CedarLoom wrote for a part the selection switches off taken out where it is unchanged; and `recorded`, the record of
 * the entries CedarLoom wrote, as the plan leaves them. `held` names the parts that wait for approval to add an entry,
 * for a devDependency, or for a file that holds another entry of their server's name.
 */
export const mcpWrites = ({
  resolved,
  project,
  approved,
  recorded,
}: {
  resolved: Resolved;
  project: string;
  approved: ReadonlySet<string>;
  recorded: ServersRecord;
}): Result<{ operations: Operation[]; findings: Finding[]; held: string[]; recorded: ServersRecord }> => {
  const parts = Object.entries(resolved.profile.project).filter(
    (each): each is [string, Part] => each[1].type === "mcp",
  );
  const on = parts.filter(([id]) => resolved.on.has(`project.${id}`));
  // Only an explicit off removes, as the selection is this machine's and the record everyone's: a default-off part or
  // one held back by a part it requires takes nothing out.
  const names = new Set(on.map(([, part]) => part.server));
  const off = parts.filter(([id, part]) => resolved.switchedOff.includes(`project.${id}`) && !names.has(part.server));
  // With no part on or switched off, the files are not even read.
  if (on.length + off.length === 0) return { ok: true, value: { operations: [], findings: [], held: [], recorded } };
  const twice = on.find(([, part], index) => on.slice(0, index).some(([, other]) => other.server === part.server));
  if (twice !== undefined)
    return refuse({
      code: "profile.target-twice",
      params: { part: `project.${twice[0]}`, target: `mcpServers.${twice[1].server}` },
    });
  const context = contextOf(project, approved, on, recorded);
  if (!context.ok) return context;
  const { documents } = context.value;
  const outcomes = on.map((each) => ({ key: `project.${each[0]}`, ...onPart(context.value, each) }));
  const findings = [...outcomes.flatMap((each) => each.findings), ...off.flatMap((each) => offPart(documents, each))];
  const operations: Operation[] = [];
  for (const document of documents) {
    const write = document.operations();
    if (!write.ok) return write;
    operations.push(...write.value);
  }
  const held = outcomes.flatMap((each) => (each.held ? [each.key] : []));
  return { ok: true, value: { operations, findings, held, recorded: recordAfter(recorded, documents) } };
};
