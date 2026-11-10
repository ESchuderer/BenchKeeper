import { statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { canonicalJson, type Finding, isTree, type Json, type Operation, type Result } from "@cedarloom/contracts";
import { sha256 } from "@cedarloom/ledger";
import { tomlOf, tomlState, tomlTable, withTable } from "./codex-config.ts";
import { onDisk, readSettings } from "./machine.ts";
import { type Resolved, textFile } from "./resolve.ts";

type Part = Extract<Resolved["profile"]["project"][string], { type: "mcp" }>;
type Launch = { command: string; args: string[]; variables: string[] } | { url: string; variables: string[] };
type State = "equal" | "absent" | "differs";
// One file of servers as the plan changes it, each change checked against what the file holds by then.
type Document = {
  file: string;
  entry: (server: string, launch: Launch) => string;
  state: (server: string, launch: Launch) => State;
  add: (server: string, launch: Launch) => void;
  operations: () => Result<Operation[]>;
};

const MCP_JSON = ".mcp.json";
const CODEX = ".codex/config.toml";
const refuse = (finding: Finding): Result<never> => ({ ok: false, finding });

const pinned = (name: string, version: string | undefined) => (version === undefined ? name : `${name}@${version}`);
// `npx --no` never downloads, so only the project's own install runs: docs/agents/cedarloom-rationale.md#mcp-servers
const launchOf = (source: Part["source"]): Launch => {
  if ("url" in source) return { url: source.url, variables: source.bearer === undefined ? [] : [source.bearer] };
  const variables = source.env ?? [];
  if ("npm" in source) return { command: "npx", args: ["-y", pinned(source.npm, source.version)], variables };
  if ("devDependency" in source) return { command: "npx", args: ["--no", source.devDependency], variables };
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

const jsonText = (server: string, launch: Launch) => `${JSON.stringify(server)}: ${JSON.stringify(jsonEntry(launch))}`;

// The file's own indent (a tab, or its first indented line's spaces), line ending and final break; a new or one-line
// file gets two spaces, LF and a break.
const asWritten = (json: Json, text: string | null): string => {
  const indent = /^([ \t]+)\S/m.exec(text ?? "")?.[1] ?? "  ";
  const eol = text?.includes("\r\n") ? "\r\n" : "\n";
  const end = text === null || text.endsWith("\n") ? eol : "";
  return `${JSON.stringify(json, null, indent).replaceAll("\n", eol)}${end}`;
};

const jsonFile = (path: string): Result<Document> => {
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
  return { ok: true, value: { file: MCP_JSON, entry: jsonText, state, add, operations } };
};

const tomlFile = (path: string): Result<Document> => {
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
  const add = (server: string, launch: Launch) => {
    text = withTable(text, tomlEntry(server, launch));
  };
  return { ok: true, value: { file: CODEX, entry: tomlEntry, state, add, operations } };
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
const contextOf = (project: string, approved: ReadonlySet<string>, on: [string, Part][]): Result<Context> => {
  const codex = isFolder(join(project, ".codex"));
  const targets: [string, (path: string) => Result<Document>][] = [[MCP_JSON, jsonFile]];
  if (codex) targets.push([CODEX, tomlFile]);
  const documents: Document[] = [];
  for (const [target, open] of targets) {
    const document = opened(project, target, open);
    if (!document.ok) return document;
    documents.push(document.value);
  }
  const installed = on.some(([, part]) => "devDependency" in part.source);
  const manifest = installed ? readSettings(join(project, "package.json")) : { ok: true as const, value: { json: {} } };
  if (!manifest.ok) return manifest;
  return { ok: true, value: { documents, approved, project, codex, manifest: manifest.value.json } };
};

const listed = (manifest: Json, name: string): boolean => {
  const dependencies = isTree(manifest) ? manifest["devDependencies"] : undefined;
  return isTree(dependencies) && typeof dependencies[name] === "string";
};

type Approval = { key: string; part: Part; launch: Launch; entries: { file: string; entry: string }[] };
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

type Outcome = { findings: Finding[]; held: boolean };
// An on part's entry goes where it is absent once approved by name; a file holding another entry of its name holds it.
const onPart = (context: Context, [id, part]: [string, Part]): Outcome => {
  const [key, { server, source }] = [`project.${id}`, part];
  if ("devDependency" in source && !listed(context.manifest, source.devDependency)) {
    const params = { part: key, package: source.devDependency };
    return { held: true, findings: [{ code: "profile.mcp-dependency", params }] };
  }
  const launch = launchOf(source);
  const states = context.documents.map((document) => ({ document, state: document.state(server, launch) }));
  const differ = states.filter(({ state }) => state === "differs");
  if (differ.length > 0) {
    const findings = differ.map(
      ({ document }): Finding => ({ code: "profile.mcp-conflict", params: { part: key, server, file: document.file } }),
    );
    return { held: true, findings };
  }
  const absent = states.flatMap(({ document, state }) => (state === "absent" ? [document] : []));
  const entries = absent.map((document) => ({ file: document.file, entry: document.entry(server, launch) }));
  if (absent.length === 0) return { held: false, findings: [] };
  if (!context.approved.has(key))
    return { held: true, findings: [approvalOf(context, { key, part, launch, entries })] };
  for (const document of absent) document.add(server, launch);
  const findings = entries.map(
    ({ file, entry }): Finding => ({ code: "profile.mcp-entry", params: { part: key, server, file, entry } }),
  );
  return { held: false, findings };
};

/**
 * The MCP parts' servers in the project's `.mcp.json`, and in `.codex/config.toml` where the project has `.codex/`:
 * each on part's entry once `approved` names it; a part that is off leaves its entry, as CedarLoom cannot tell its own
 * from the owner's until the per-entry record. `held` names the parts that wait for approval, for a devDependency, or
 * for a file that holds another entry of their server's name.
 */
export const mcpWrites = ({
  resolved,
  project,
  approved,
}: {
  resolved: Resolved;
  project: string;
  approved: ReadonlySet<string>;
}): Result<{ operations: Operation[]; findings: Finding[]; held: string[] }> => {
  const parts = Object.entries(resolved.profile.project).filter(
    (each): each is [string, Part] => each[1].type === "mcp",
  );
  const on = parts.filter(([id]) => resolved.on.has(`project.${id}`));
  // With no part on, the files are not even read: one the plan cannot open stops only a plan that adds.
  if (on.length === 0) return { ok: true, value: { operations: [], findings: [], held: [] } };
  const twice = on.find(([, part], index) => on.slice(0, index).some(([, other]) => other.server === part.server));
  if (twice !== undefined)
    return refuse({
      code: "profile.target-twice",
      params: { part: `project.${twice[0]}`, target: `mcpServers.${twice[1].server}` },
    });
  const context = contextOf(project, approved, on);
  if (!context.ok) return context;
  const outcomes = on.map((each) => ({ key: `project.${each[0]}`, ...onPart(context.value, each) }));
  const findings = outcomes.flatMap((each) => each.findings);
  const operations: Operation[] = [];
  for (const document of context.value.documents) {
    const write = document.operations();
    if (!write.ok) return write;
    operations.push(...write.value);
  }
  const held = outcomes.flatMap((each) => (each.held ? [each.key] : []));
  return { ok: true, value: { operations, findings, held } };
};
