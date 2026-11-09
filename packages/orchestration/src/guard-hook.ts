import { isAbsolute } from "node:path";
import { text } from "node:stream/consumers";
import { GUARD_SCHEMA_VERSION, GuardPolicy, readDocument } from "@cedarloom/contracts";
import { type CallPolicy, guardCommand, MAY_MERGE, type Remotes } from "./guard.ts";
import { gitRemotes, originRepos } from "./session-guard.ts";

// A folder's remotes, with or without a typed URL, read once per hook run.
const once = (remotes: Remotes): Remotes => {
  const read = new Map<string, ReturnType<Remotes>>();
  return (folder, url) => {
    const key = JSON.stringify([folder, url ?? null]);
    if (!read.has(key)) read.set(key, remotes(folder, url));
    return read.get(key) ?? null;
  };
};

const field = (object: unknown, key: string): unknown =>
  typeof object === "object" && object !== null ? Reflect.get(object, key) : undefined;

const readPolicy = (json: string): GuardPolicy | null => {
  try {
    const read = readDocument(GuardPolicy, GUARD_SCHEMA_VERSION, JSON.parse(json));
    return read.ok ? read.value : null;
  } catch {
    return null;
  }
};

interface Call {
  tool: unknown;
  command: unknown;
  cwd: unknown;
  isolation: unknown;
  subagent: unknown;
  agent: unknown;
  agentId: unknown;
}

// The parts of a PreToolUse input the guard reads; null for input that is no JSON.
const readCall = (input: string): Call | null => {
  try {
    const call: unknown = JSON.parse(input);
    const [command, isolation, subagent] = ["command", "isolation", "subagent_type"].map((key) =>
      field(field(call, "tool_input"), key),
    );
    return {
      tool: field(call, "tool_name"),
      command,
      cwd: field(call, "cwd"),
      isolation,
      subagent,
      agent: field(call, "agent_type"),
      agentId: field(call, "agent_id"),
    };
  } catch {
    return null;
  }
};

// The agent type Claude Code gives a workflow script's agents, which may merge at Auto.
const WORKFLOW_AGENT = "workflow-subagent";

// A subagent of a type: it has an agent id, which a session started as that type (`claude --agent`) lacks (hooks docs).
const isAgent = (call: Call | null, type: (agent: string) => boolean): boolean =>
  typeof call?.agent === "string" && type(call.agent) && typeof call.agentId === "string" && call.agentId !== "";

// Whether a workflow agent merges at this call, and whether the full guard limits the caller.
type Reach = { readonly merges: boolean; readonly limited: boolean };

// Why the guard refuses to start an agent, or null.
const agentRefusal = ({ isolation, subagent }: Call, { merges }: Reach): string | null => {
  // A remote subagent runs in the cloud, where no hook of this session reads its commands.
  if (isolation === "remote") return "a remote agent runs where the guard reads nothing";
  // Where workflow agents may merge, a project's agent of that name would merge as one.
  return merges && subagent === WORKFLOW_AGENT ? `the agent type ${WORKFLOW_AGENT} is kept for workflow scripts` : null;
};

const UNREADABLE = "its input is no tool call with a command and an absolute folder";
const SHELL_TOOLS = new Set(["Bash", "Monitor", "PowerShell"]);

const located = (command: unknown, cwd: unknown): { command: string; cwd: string } | string =>
  typeof command === "string" && typeof cwd === "string" && isAbsolute(cwd) ? { command, cwd } : UNREADABLE;

// The command a call runs in its folder, null for a call that runs no shell command, or why the guard cannot read it.
const commandOf = (call: Call | null, reach: Reach): { command: string; cwd: string } | string | null => {
  if (call === null || typeof call.tool !== "string") return UNREADABLE;
  const { tool, command, cwd } = call;
  if (tool === "Agent") return agentRefusal(call, reach);
  // A Monitor call without a command watches a WebSocket and runs nothing.
  if (!SHELL_TOOLS.has(tool) || (tool === "Monitor" && command === undefined)) return null;
  if (tool !== "PowerShell") return located(command, cwd);
  // PowerShell, which the guard does not read, refuses a workflow agent (its shell is Bash) and text naming a merge.
  return reach.limited || MAY_MERGE.test(String(command)) ? "the guard reads no PowerShell; use the Bash tool" : null;
};

/**
 * The policy as this call meets it. A limited caller: `origin` read from the working folder, with the hub and the
 * memory repository; a workflow script's agent merges only at Auto, which a stage reaches after its reviewer agreed
 * (owner 2026-11-08), and only in the origin's own repositories: never the hub's, nor the memory repository's, whose
 * `main` no agent updates. Any other caller, as the package's hooks run in every session: no repository limit, and what
 * the guard cannot read runs; merges, approvals and the other rules hold (Q5, option b until the owner answers).
 */
const callPolicy = (policy: GuardPolicy, cwd: string, { merges, limited }: Reach, remotes: Remotes): CallPolicy => {
  const origin = limited && (policy.repositories === "origin" || merges) ? originRepos(cwd, remotes) : [];
  const bound = [policy.hub, policy.memory].filter((repo) => repo !== null);
  const repositories = policy.repositories === "origin" ? [...new Set([...origin, ...bound])] : policy.repositories;
  return {
    ...policy,
    repositories: limited ? repositories : null,
    merge: merges ? origin.filter((repo) => !bound.some((other) => other.toLowerCase() === repo.toLowerCase())) : [],
    lenient: !limited,
  };
};

// Why the guard refuses one PreToolUse input, or null; what it cannot read refuses a workflow's agents (A79).
const guardHook = (input: string, policyJson: string | null, remotes: Remotes): string | null => {
  const policy = policyJson === null ? null : readPolicy(policyJson);
  if (policy === null) return "its policy is missing or invalid";
  const read = readCall(input);
  const [auto, workflow] = [policy.merge === "workflow", isAgent(read, (type) => type === WORKFLOW_AGENT)];
  // A step's own subagent (`<plugin>:<step>`) and any caller of a worker's policy, which lists its repositories, too.
  const limited = workflow || isAgent(read, (type) => type.includes(":")) || policy.repositories !== "origin";
  const call = commandOf(read, { merges: auto, limited });
  if (call === null || typeof call === "string") return call;
  const reach = { merges: auto && workflow, limited };
  const denial = guardCommand(call.command, call.cwd, callPolicy(policy, call.cwd, reach, remotes), remotes);
  return denial === null ? null : `${denial.detail} (${denial.rule})`;
};

// Exit code 2 with the reason on stderr refuses; the launch's onFailure "block" makes a crash refuse too.
try {
  const reason = guardHook(await text(process.stdin), process.argv[2] ?? null, once(gitRemotes));
  if (reason !== null) {
    process.stderr.write(`CedarLoom's guard refused this call: ${reason}.\n`);
    process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(`CedarLoom's guard failed, so the call is refused: ${String(error)}\n`);
  process.exitCode = 2;
}
