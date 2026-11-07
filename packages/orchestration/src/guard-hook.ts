import { readFileSync } from "node:fs";
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

// The command a call runs in its folder; "none" for a call that runs no shell command, "unreadable" for one the guard
// cannot read.
const commandOf = (call: ReturnType<typeof readCall>): { command: string; cwd: string } | "none" | "unreadable" => {
  if (call === null) return "unreadable";
  const { tool, command, cwd } = call;
  if (tool !== "Bash" && tool !== "Monitor") return typeof tool === "string" ? "none" : "unreadable";
  // A Monitor call without a command watches a WebSocket and runs nothing.
  if (tool === "Monitor" && command === undefined) return "none";
  return typeof command === "string" && typeof cwd === "string" && isAbsolute(cwd) ? { command, cwd } : "unreadable";
};

/**
 * The guard's answer to one PreToolUse input: why it refuses the call, or null to let it through. What it cannot read
 * refuses (A79): a missing or invalid policy, input that is no JSON, a Bash call without its command or folder.
 */
export const guardHook = (input: string, policyJson: string | null): string | null => {
  const policy = policyJson === null ? null : readPolicy(policyJson);
  if (policy === null) return "its policy file is missing or invalid";
  const call = commandOf(readCall(input));
  if (call === "none") return null;
  if (call === "unreadable") return "its input is no tool call with a command and an absolute folder";
  const denial = guardCommand(call.command, policy);
  return denial === null ? null : `${denial.detail} (${denial.rule})`;
};

// Run by Claude Code as a PreToolUse command hook, the policy file its argument: exit code 2 with the reason on stderr
// refuses the call. A crash refuses it too, through the hook's onFailure "block".
if (import.meta.main) {
  try {
    const path = process.argv[2];
    const policy = path === undefined ? null : readFileSync(path, "utf8");
    const reason = guardHook(await text(process.stdin), policy);
    if (reason !== null) {
      process.stderr.write(`CedarLoom's guard refused this call: ${reason}.\n`);
      process.exitCode = 2;
    }
  } catch (error) {
    process.stderr.write(`CedarLoom's guard failed, so the call is refused: ${String(error)}\n`);
    process.exitCode = 2;
  }
}
