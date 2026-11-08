// The code every stage script runs (https://code.claude.com/docs/en/workflows): each function is written into the
// script as its source, so it uses only its parameters, the other functions here and JavaScript's built-ins.

/** Where a value comes from: a workflow input, or a node's output as `node.handle`. */
export type Source = { input: string } | { output: string };

/** One node of a stage as its script runs it. */
export type Step = {
  id: string;
  kind: "start" | "agent" | "command" | "check" | "condition" | "join" | "pass" | "stop";
  /** The nodes that settle before it: its sources in the stage. */
  after: string[];
  /** The control outputs (`node.handle`) that must all fire, else it is skipped. */
  run: string[];
  /** Whether an edge leaves its `failed` output; a failure nothing takes ends the stage under fail_fast. */
  handled?: boolean;
  failFast?: boolean;
  prompt?: string;
  context?: Source;
  options?: Record<string, unknown>;
  retries?: number;
  /** The checks of an agent step, by id; a check or command step's skill as `plugin:skill`. */
  checks?: string[];
  skill?: string;
  value?: Source;
  /** A gate the level keeps: its message and the commands that go on. */
  message?: string;
  next?: string[];
};

/** A stage: its steps, the outputs fired and nodes settled before it starts, and the inputs' defaults. */
export type StageScript = {
  steps: Step[];
  fired: string[];
  settled: string[];
  defaults: Record<string, unknown>;
  /** The inputs a run must give, and how many steps run side by side at most. */
  required: string[];
  concurrency: number;
};

/** What a stage returns: the steps that ran, failed and were skipped, and the gates it stopped at. */
type Report = {
  done: string[];
  failed: string[];
  skipped: string[];
  stops: { gate: string; message: string; next: string[] }[];
};

/** The workflow runtime's functions a stage uses, and the arguments it was started with. */
type Runtime = {
  agent: (prompt: string, options?: Record<string, unknown>) => Promise<unknown>;
  parallel: (thunks: (() => Promise<unknown>)[]) => Promise<unknown[]>;
  args: unknown;
};

type State = {
  stage: StageScript;
  inputs: Record<string, unknown>;
  fired: Set<string>;
  values: Map<string, unknown>;
  settled: Set<string>;
  report: Report;
  ended: boolean;
};

type Ran = { exitCode: number; output: string };

/** The workflow's inputs: a JSON object, as text or as a value, over the defaults; a required one missing ends the run. */
const inputsOf = (args: unknown, stage: StageScript): Record<string, unknown> => {
  const given: unknown = typeof args === "string" && args.trim() !== "" ? JSON.parse(args) : args;
  const inputs = { ...stage.defaults, ...(typeof given === "object" && given !== null ? given : {}) };
  const missing = stage.required.filter((name) => !(name in inputs));
  if (missing.length > 0) throw new Error(`The workflow needs the inputs ${missing.join(", ")}.`);
  return inputs;
};

const valueOf = (state: State, source: Source | undefined): unknown => {
  if (source === undefined) return undefined;
  return "input" in source ? state.inputs[source.input] : state.values.get(source.output);
};

/** A command or check step: an agent runs the step's skill and reports; null when it could not. */
const runCommand = async (step: Step, rt: Runtime): Promise<Ran | null> => {
  const schema = {
    type: "object",
    required: ["exitCode", "output"],
    properties: { exitCode: { type: "integer" }, output: { type: "string" } },
  };
  const prompt = `Use the skill ${step.skill ?? ""}: run its script exactly as it says, then return the script's exit code and the last 100 lines of its output.`;
  const ran = await rt.agent(prompt, { label: step.id, schema });
  return typeof ran === "object" && ran !== null && "exitCode" in ran && "output" in ran
    ? { exitCode: Number(ran.exitCode), output: String(ran.output) }
    : null;
};

/** The first check of an agent step that fails, or null when all pass. */
const failingCheck = async (step: Step, state: State, rt: Runtime): Promise<(Ran & { id: string }) | null> => {
  for (const id of step.checks ?? []) {
    const check = state.stage.steps.find((each) => each.id === id);
    const ran = check === undefined ? null : await runCommand(check, rt);
    if (ran === null || ran.exitCode !== 0) return { id, exitCode: ran?.exitCode ?? -1, output: ran?.output ?? "" };
  }
  return null;
};

/** A value as prompt text. */
const textOf = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value));

/** An agent step's agent, started again while it fails, `retries` times at most; null when every try failed. */
const attempt = async (step: Step, prompt: string, rt: Runtime): Promise<unknown> => {
  for (let tries = 0; tries <= (step.retries ?? 0); tries += 1) {
    const result = await rt.agent(prompt, step.options);
    if (result !== null) return result;
  }
  return null;
};

/** An agent step: sent back while a check fails, for three rounds at most. */
const runAgent = async (step: Step, state: State, rt: Runtime): Promise<boolean> => {
  const context = valueOf(state, step.context);
  let prompt = `${step.prompt ?? ""}${context === undefined ? "" : `\n\nContext:\n${textOf(context)}`}`;
  for (let round = 0; round < 3; round += 1) {
    const result = await attempt(step, prompt, rt);
    if (result === null) return false;
    const failing = await failingCheck(step, state, rt);
    if (failing === null) {
      state.values.set(`${step.id}.result`, textOf(result));
      return true;
    }
    prompt = `${prompt}\n\nThe check ${failing.id} failed with exit code ${failing.exitCode}:\n${failing.output}\nFix the work so that it passes.`;
  }
  return false;
};

/** A command step's outputs, run again while it fails, `retries` times at most; its output and exit code are kept. */
const commandOutputs = async (step: Step, state: State, rt: Runtime): Promise<string[]> => {
  let ran = await runCommand(step, rt);
  for (let tries = 0; tries < (step.retries ?? 0) && ran?.exitCode !== 0; tries += 1) ran = await runCommand(step, rt);
  if (ran === null) return ["failed"];
  state.values.set(`${step.id}.stdout`, ran.output);
  state.values.set(`${step.id}.exitCode`, ran.exitCode);
  return [ran.exitCode === 0 ? "done" : "failed"];
};

/** Runs one step and returns the outputs it fires. */
const fire = async (step: Step, state: State, rt: Runtime): Promise<string[]> => {
  if (step.kind === "agent") return (await runAgent(step, state, rt)) ? ["done"] : ["failed"];
  if (step.kind === "command") return commandOutputs(step, state, rt);
  if (step.kind === "condition") {
    // A value that is no boolean decides nothing: the condition fails rather than take a branch.
    const value = valueOf(state, step.value);
    return [typeof value === "boolean" ? String(value) : "failed"];
  }
  if (step.kind === "stop") {
    state.report.stops.push({ gate: step.id, message: step.message ?? "", next: step.next ?? [] });
    return [];
  }
  return [{ start: "start", pass: "approved", join: "done", check: "done" }[step.kind]];
};

/** Settles one step: skipped unless all its control sources fired, else run. */
const settle = async (step: Step, state: State, rt: Runtime): Promise<void> => {
  if (state.ended || !step.run.every((key) => state.fired.has(key))) {
    state.report.skipped.push(step.id);
  } else {
    // A runtime error of an agent (it stalled on every attempt) fails the step, as a failed agent does.
    const outputs = await fire(step, state, rt).catch(() => ["failed"]);
    for (const handle of outputs) state.fired.add(`${step.id}.${handle}`);
    const failed = outputs.includes("failed");
    // A gate the level keeps fires nothing: the stage stops there, and its report says so.
    if (outputs.length > 0) (failed ? state.report.failed : state.report.done).push(step.id);
    if (failed && step.handled !== true && step.failFast === true) state.ended = true;
  }
  state.settled.add(step.id);
};

/** Runs a stage in waves: each wave the steps whose sources have settled, side by side. */
const runStage = async (stage: StageScript, rt: Runtime): Promise<Report> => {
  const state: State = {
    stage,
    inputs: inputsOf(rt.args, stage),
    fired: new Set(stage.fired),
    values: new Map(),
    settled: new Set(stage.settled),
    report: { done: [], failed: [], skipped: [], stops: [] },
    ended: false,
  };
  const ready = (): Step[] =>
    stage.steps.filter((step) => !state.settled.has(step.id) && step.after.every((id) => state.settled.has(id)));
  for (let wave = ready(); wave.length > 0; wave = ready()) {
    await rt.parallel(wave.slice(0, stage.concurrency).map((step) => () => settle(step, state, rt)));
  }
  return state.report;
};

/** The functions a stage script carries, in the order it declares them. */
export const RUNNER = [
  inputsOf,
  valueOf,
  runCommand,
  failingCheck,
  textOf,
  attempt,
  runAgent,
  commandOutputs,
  fire,
  settle,
  runStage,
];
