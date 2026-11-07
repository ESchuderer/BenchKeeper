import { isAbsolute } from "node:path";
import { text } from "node:stream/consumers";
import { GUARD_SCHEMA_VERSION, GuardPolicy, readDocument } from "@cedarloom/contracts";
import { guardCommand } from "./guard.ts";

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
const readCall = (input: string): { tool: unknown; command: unknown; cwd: unknown } | null => {
  try {
    const call: unknown = JSON.parse(input);
    return {
      tool: field(call, "tool_name"),
      command: field(field(call, "tool_input"), "command"),
      cwd: field(call, "cwd"),
    };
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
  // A Monitor call without a command watches a WebSocket and runs nothing.
  if (!SHELL_TOOLS.has(tool) || (tool === "Monitor" && command === undefined)) return null;
  // On Windows the launch requires Git Bash, so the Bash tool runs every command.
  return tool === "PowerShell"
    ? "the guard reads no PowerShell; run the command with the Bash tool"
    : located(command, cwd);
};

/**
 * The guard's answer to one PreToolUse input: why it refuses the call, or null to let it through. What it cannot read
 * refuses (A79): a missing or invalid policy, input that is no JSON, a Bash call without its command or folder.
 */
const guardHook = (input: string, policyJson: string | null): string | null => {
  if (policyJson === null || readPolicy(policyJson) === null) return "its policy is missing or invalid";
  const call = commandOf(readCall(input));
  if (call === null || typeof call === "string") return call;
  const denial = guardCommand(call.command);
  return denial === null ? null : `${denial.detail} (${denial.rule})`;
};

// Run by Claude Code as a PreToolUse command hook, the policy's JSON its argument, so it reads no file: exit code 2 with
// the reason on stderr refuses the call. A crash refuses it too, through the hook's onFailure "block".
try {
  const reason = guardHook(await text(process.stdin), process.argv[2] ?? null);
  if (reason !== null) {
    process.stderr.write(`CedarLoom's guard refused this call: ${reason}.\n`);
    process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(`CedarLoom's guard failed, so the call is refused: ${String(error)}\n`);
  process.exitCode = 2;
}
