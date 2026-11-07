import { type Finding, findingInfo } from "@cedarloom/contracts";
import type { PlanPreview } from "@cedarloom/contracts";
import type { ClaudeLaunch } from "@cedarloom/adapter-claude";
import type { AgentOptions, Fetch, LoginRun, LoginStatus } from "@cedarloom/use-cases";
import { describe } from "./messages.ts";

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
  env: Record<string, string | undefined>;
  /** Settles when a long-running command such as `ui` should end; the program waits for SIGINT or SIGTERM. */
  untilStopped: () => Promise<void>;
  /** Runs the agent's own login in this terminal with `env`, and tells how it ended. */
  login: (env: Record<string, string>) => LoginRun;
  /** Asks the agent for the login of the config folder `env` names. */
  authStatus: (env: Readonly<Record<string, string>>) => Promise<LoginStatus>;
  /** How Git sources are fetched: over https and ssh unless a test hands over its own trees. */
  fetch?: Fetch;
  /** The agent CLI that `agent.run` nodes start. */
  agent: AgentOptions<ClaudeLaunch>["runtime"];
}

export interface Context {
  io: Io;
  json: boolean;
  state: string;
  config: string;
}

/** sysexits: 64 usage, 65 data, 66 missing input, 70 internal; 1 when a rule refused the change. */
export const EXIT = { ok: 0, refused: 1, usage: 64, data: 65, noInput: 66, internal: 70 } as const;

/** `--json`: one object with a format name, a schema version, codes and parameters; otherwise the text for people. */
export const emit = (ctx: Context, format: string, data: Record<string, unknown>, human: string): void => {
  if (ctx.json) ctx.io.out(`${JSON.stringify({ format: `cedarloom.${format}`, schemaVersion: 1, ...data })}\n`);
  else if (human !== "") ctx.io.out(`${human}\n`);
};

export const report = (ctx: Context, findings: Finding[], to: "out" | "err" = "err"): void => {
  if (ctx.json) return;
  for (const finding of findings) ctx.io[to](`${findingInfo[finding.code].severity}: ${describe(finding)}\n`);
};

/** Emits the findings as the command's result and returns its exit code. */
export const fail = (ctx: Context, format: string, findings: Finding[], code: number): number => {
  emit(ctx, format, { findings }, "");
  report(ctx, findings);
  return code;
};

export const showPlan = ({ planHash, plan }: PlanPreview): string => {
  const lines = plan.operations.map((op) => {
    if (op.kind === "delete") return `  delete  ${op.path}`;
    const how = op.before === null ? "create" : "replace";
    const mode = op.mode === undefined ? "" : `, mode ${op.mode.toString(8).padStart(4, "0")}`;
    return `  write   ${op.path} (${how}, ${op.bytes} bytes${mode})`;
  });
  return [`Plan ${planHash}:`, ...lines].join("\n");
};
