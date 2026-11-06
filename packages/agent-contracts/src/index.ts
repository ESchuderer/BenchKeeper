import type { ContractCheckRecord, Json, QuotaWindow, RunLabels } from "@cedarloom/contracts";

/** How far an adapter supports a feature; `unknown` means untested and is never read as `unsupported`. */
export type CapabilityState = "supported" | "partial" | "unsupported" | "unknown";

/** The features of the capability matrix: the session operations and the usage readings. */
export type Capability = "start" | "observe" | "cancel" | "resume" | "handover" | "usage";

/** Reasoning effort of a session; workers stop at `xhigh`, because higher effort spends the usage windows fastest. */
export type Effort = RunLabels["effort"];

/** What every adapter needs to start a session; an adapter's launch options add its own settings. */
export interface Launch {
  /** The account's config folder, which selects its login: an absolute path to an existing folder. */
  readonly home: string;
  readonly cwd: string;
  readonly prompt: string;
  /** A full model ID, never an alias: an alias moves to another model between CLI versions. */
  readonly model: string;
  /** The model every subagent runs on, pinned for the phase. */
  readonly subagentModel: string;
  readonly effort: Effort;
  /**
   * The whole environment of the agent process, without login variables; nothing of the caller's is inherited, except
   * that on Windows libuv adds the system variables a process needs, PATH among them, when they are missing
   * (`required_vars` in https://github.com/libuv/libuv/blob/v1.x/src/win/process.c).
   */
  readonly env: Readonly<Record<string, string>>;
  /** The agent's permission mode for the session, as the adapter names it; a run's labels record it (A90). */
  readonly permissionMode: string;
  /** The worker's own temporary folder, apart from every other worker's. */
  readonly tmpDir: string;
  /** The file the worker ends with its result in, outside the working folder: the one file it may write there. */
  readonly resultFile: string;
  /** Absolute paths the agent's shell commands and file tools must not read: account homes and credential folders. */
  readonly denyRead: readonly string[];
  /** Hosts the agent's shell commands may reach; every other host is refused. */
  readonly allowedDomains: readonly string[];
  /** CLI versions whose contract check passed: an undocumented reading such as usage is reported on these only. */
  readonly verifiedVersions: readonly string[];
}

/** One usage window as the agent reported it. */
export interface UsageWindow {
  /** The agent's name for the window, such as `five_hour`. */
  readonly window: string;
  readonly status: string;
  /** Used share of the window, 0 to 100; null when the agent sent none. */
  readonly percent: number | null;
  /** ISO time of the window's reset; null when the agent sent none. */
  readonly resetsAt: string | null;
  /** The agent-neutral window it is, which readings are stored under; null for a window the quota model lacks. */
  readonly quota: QuotaWindow | null;
}

/** Why a session ended in the adapter: the process failed to start or stop, or it wrote a line past the adapter's cap. */
export type SessionError =
  | { readonly code: "process"; readonly message: string }
  | { readonly code: "line-too-long"; readonly limitBytes: number };

/** What a session reports, in order; `raw` is the agent's own line, kept for the ledger. */
export type AgentEvent =
  | {
      readonly type: "init";
      readonly sessionId: string;
      /** The CLI version the session runs; null when the agent reports none of the known form. */
      readonly agentVersion: string | null;
      readonly model: string;
      /** The tools the session offers; null when the agent does not list them. */
      readonly tools: readonly string[] | null;
      /** Whether this session's own init line proves that the CLI applied the launch's settings, sandbox included. */
      readonly settingsApplied: boolean;
      readonly raw: Json;
    }
  | {
      readonly type: "usage";
      readonly agentVersion: string;
      readonly windows: readonly UsageWindow[];
      readonly raw: Json;
    }
  | { readonly type: "result"; readonly ok: boolean; readonly text: string | null; readonly raw: Json }
  | { readonly type: "other"; readonly raw: Json }
  | {
      readonly type: "exit";
      readonly code: number | null;
      readonly signal: string | null;
      readonly error: SessionError | null;
      /** The end of the process's error output. */
      readonly stderr: string;
    };

/** One running agent process. */
export interface AgentSession {
  /** Observes the session: its events, the last one `exit`. Read it once and to the end, or the process stalls. */
  readonly events: AsyncIterable<AgentEvent>;
  /** Stops the process; resolves once it has exited. */
  cancel(): Promise<void>;
}

/** The result of a contract check: the CLI version that ran and the expected parts its output lacked. */
export interface ContractCheck {
  readonly version: string | null;
  /**
   * The expected parts the probe's output lacked; empty when the check passed. `settings`: no proof that the CLI
   * applied the launch's settings, without which no worker starts.
   */
  readonly missing: readonly ContractCheckRecord["missing"][number][];
}

/** The contract of an agent adapter; `L` is the adapter's launch options. */
export interface AgentRuntime<L extends Launch = Launch> {
  readonly capabilities: Readonly<Record<Capability, CapabilityState>>;
  /** The CLI version that `env` (a launch's environment) runs; compared before each launch, as the CLI updates itself. */
  version(env: Readonly<Record<string, string>>): Promise<string>;
  /** Runs a probe session and checks the undocumented parts of its output; rerun whenever the version changes. */
  checkContract(launch: Omit<L, "prompt" | "verifiedVersions">): Promise<ContractCheck>;
  start(launch: L): AgentSession;
  resume(sessionId: string, launch: L): AgentSession;
  /** Stops `from` first, then starts `to`, whose prompt carries the handover. */
  handover(from: AgentSession, to: L): Promise<AgentSession>;
}
