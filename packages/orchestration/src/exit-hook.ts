import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { text } from "node:stream/consumers";

// A step script's last line, which the emitter writes: the script's own exit status, whatever the agent adds around it.
const MARKER = /^cedarloom-exit (\d+)$/gm;
const STEP_SCRIPT = /\/steps\/[a-z0-9-]+\/scripts\/run\.sh/;

const field = (object: unknown, key: string): unknown =>
  typeof object === "object" && object !== null ? Reflect.get(object, key) : undefined;

const idOf = (value: unknown): string => (typeof value === "string" && /^[\w-]{1,128}$/.test(value) ? value : "main");

// Where an agent's last step script run is kept: the plugin's data folder, one file per session and agent.
const fileOf = (call: unknown, data: string): string =>
  join(data, "exits", `${idOf(field(call, "session_id"))}-${idOf(field(call, "agent_id"))}`);

/**
 * Keeps the exit status of a step script a Bash call ran (PostToolUse or PostToolUseFailure); nothing for other calls,
 * nor without a data folder, where `verify` refuses.
 */
const record = (call: unknown, data: string | undefined): void => {
  const command = field(field(call, "tool_input"), "command");
  if (data === undefined || data === "" || field(call, "tool_name") !== "Bash") return;
  if (typeof command !== "string" || !STEP_SCRIPT.test(command)) return;
  const response = field(call, "tool_response");
  const output = [field(response, "stdout"), field(response, "stderr"), field(call, "error")].filter(
    (part) => typeof part === "string",
  );
  const status = [...output.join("\n").matchAll(MARKER)].at(-1)?.[1];
  if (status === undefined) return;
  mkdirSync(join(data, "exits"), { recursive: true });
  writeFileSync(fileOf(call, data), status);
};

/**
 * Why a reported exit code is refused (PreToolUse of StructuredOutput): the script exited otherwise, or no run was seen
 * and the report is no -1, which the stage runner's prompt asks for when the command did not run.
 */
const verify = (call: unknown, data: string | undefined): string | null => {
  const reported = field(field(call, "tool_input"), "exitCode");
  if (field(call, "tool_name") !== "StructuredOutput" || typeof reported !== "number") return null;
  if (data === undefined || data === "") return "it has no plugin data folder (CLAUDE_PLUGIN_DATA)";
  let status: number;
  try {
    status = Number(readFileSync(fileOf(call, data), "utf8"));
  } catch {
    if (reported === -1) return null;
    return "no run of the step's script was seen: run it with Bash exactly as written, then report its exit code";
  }
  return status === reported ? null : `the step's script exited with ${status}: report exit code ${status}`;
};

/** The exit hook's verdict on one input: `record` keeps a step script's status, `verify` refuses a report that differs. */
const exitHook = (mode: string, input: string, data: string | undefined): string | null => {
  let call: unknown;
  try {
    call = JSON.parse(input);
  } catch {
    // After a call, nothing is refused: what `record` cannot read, `verify` finds missing.
    return mode === "record" ? null : "its input is no JSON";
  }
  if (mode === "record") {
    record(call, data);
    return null;
  }
  return mode === "verify" ? verify(call, data) : `it knows no mode ${mode}`;
};

// Exit code 2 with the reason on stderr refuses; the package's onFailure "block" makes a crash of `verify` refuse too.
const reason = exitHook(process.argv[2] ?? "", await text(process.stdin), process.env["CLAUDE_PLUGIN_DATA"]);
if (reason !== null) {
  process.stderr.write(`CedarLoom refused this call: ${reason}.\n`);
  process.exitCode = 2;
}
