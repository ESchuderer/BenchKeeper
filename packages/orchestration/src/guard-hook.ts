import { isAbsolute } from "node:path";
import { text } from "node:stream/consumers";
import { GUARD_SCHEMA_VERSION, GuardPolicy, readDocument } from "@cedarloom/contracts";
import { guardCommand, type Remotes } from "./guard.ts";
import { gitRemotes } from "./session-guard.ts";

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

// The parts of a PreToolUse input the guard reads; null for input that is no JSON.
const readCall = (input: string): { tool: unknown; command: unknown; cwd: unknown; isolation: unknown } | null => {
  try {
    const call: unknown = JSON.parse(input);
    const [command, isolation] = ["command", "isolation"].map((key) => field(field(call, "tool_input"), key));
    return { tool: field(call, "tool_name"), command, cwd: field(call, "cwd"), isolation };
  } catch {
    return null;
  }
};

const UNREADABLE = "its input is no tool call with a command and an absolute folder";
const SHELL_TOOLS = new Set(["Bash", "Monitor", "PowerShell"]);

const located = (command: unknown, cwd: unknown): { command: string; cwd: string } | string =>
  typeof command === "string" && typeof cwd === "string" && isAbsolute(cwd) ? { command, cwd } : UNREADABLE;

// The command a call runs in its folder, null for a call that runs no shell command, or why the guard cannot read it.
const commandOf = (call: ReturnType<typeof readCall>): { command: string; cwd: string } | string | null => {
  if (call === null || typeof call.tool !== "string") return UNREADABLE;
  const { tool, command, cwd } = call;
  // A remote subagent runs in the cloud, where no hook of this session reads its commands.
  if (tool === "Agent") return call.isolation === "remote" ? "a remote agent runs where the guard reads nothing" : null;
  // A Monitor call without a command watches a WebSocket and runs nothing.
  if (!SHELL_TOOLS.has(tool) || (tool === "Monitor" && command === undefined)) return null;
  // A worker's shell is Bash; PowerShell, which the guard does not read, refuses.
  return tool === "PowerShell"
    ? "the guard reads no PowerShell; run the command with the Bash tool"
    : located(command, cwd);
};

// Why the guard refuses one PreToolUse input, or null; what it cannot read refuses (A79).
const guardHook = (input: string, policyJson: string | null, remotes: Remotes): string | null => {
  const policy = policyJson === null ? null : readPolicy(policyJson);
  if (policy === null) return "its policy is missing or invalid";
  const call = commandOf(readCall(input));
  if (call === null || typeof call === "string") return call;
  const denial = guardCommand(call.command, call.cwd, policy, remotes);
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
