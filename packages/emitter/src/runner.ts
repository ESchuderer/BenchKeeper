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
  /** The checks of an agent step, by id; a check or command step's script, from the plugin's folder. */
  checks?: string[];
  script?: string;
  value?: Source;
  /** A gate the level keeps: its message, and the commands that go on with the inputs their stages take. */
  message?: string;
  next?: { command: string; inputs: string[] }[];
};

/** A stage: its steps, the outputs fired and nodes settled before it starts, and the inputs' defaults. */
export type StageScript = {
  steps: Step[];
  fired: string[];
  settled: string[];
  defaults: Record<string, unknown>;
  /** The inputs of its steps a run must give, how many steps run side by side at most, and the workflow's outputs. */
  required: string[];
  concurrency: number;
  outputs: Record<string, Source>;
};

/** What a stage returns: the steps that ran, failed and were skipped, the gates it stopped at, the workflow's outputs. */
type Report = {
  done: string[];
  failed: string[];
  skipped: string[];
  stops: { gate: string; message: string; next: string[] }[];
  outputs: Record<string, unknown>;
};

/** The workflow runtime's functions a stage uses, and the arguments it was started with. */
type Runtime = {
  agent: (prompt: string, options?: Record<string, unknown>) => Promise<unknown>;
  parallel: (thunks: (() => Promise<unknown>)[]) => Promise<unknown[]>;
  args: unknown;
};

type State = {
  stage: StageScript;
  /** The plugin's folder, which the stage's skill passes in. */
  root: string;
  inputs: Record<string, unknown>;
  fired: Set<string>;
  values: Map<string, unknown>;
  settled: Set<string>;
  report: Report;
  ended: boolean;
  /** The checks that still failed when their agent step ran out of rounds. */
  unmet: Set<string>;
};

type Ran = { exitCode: number; output: string };

/** A JSON object's entries, or none for any other value. */
const objectOf = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? { ...value } : {};

/** The args, `{root, inputs}` as JSON text or a value: the inputs over the defaults; a required one missing ends the run. */
const argsOf = (args: unknown, stage: StageScript): { root: string; inputs: Record<string, unknown> } => {
  const given = objectOf(typeof args === "string" && args.trim() !== "" ? JSON.parse(args) : args);
  const inputs = { ...stage.defaults, ...objectOf(given["inputs"]) };
  const missing = stage.required.filter((name) => !Object.hasOwn(inputs, name));
  if (missing.length > 0) throw new Error(`The workflow needs the inputs ${missing.join(", ")}.`);
  const root = typeof given["root"] === "string" ? given["root"] : "";
  // Without it no script runs: the stage ends now, not after its checks' rounds.
  if (root === "" && stage.steps.some((step) => step.script !== undefined)) {
    throw new Error("The stage needs the plugin's folder as args.root.");
  }
  return { root, inputs };
};

const valueOf = (state: State, source: Source | undefined): unknown => {
  if (source === undefined) return undefined;
  if ("output" in source) return state.values.get(source.output);
  return Object.hasOwn(state.inputs, source.input) ? state.inputs[source.input] : undefined;
};

/** A command or check step: an agent runs the step's script and reports; null when it could not. */
const runCommand = async (step: Step, state: State, rt: Runtime): Promise<Ran | null> => {
  if (state.root === "") return null;
  const schema = {
    type: "object",
    required: ["exitCode", "output"],
    properties: { exitCode: { type: "integer" }, output: { type: "string" } },
  };
  // A model reports the result: the prompt leaves it nothing to add (a low effort reported a failed check as passed).
  const path = `'${`${state.root}/${step.script ?? ""}`.replaceAll("'", `'\\''`)}'`;
  const prompt = `From the project folder, run this command with Bash exactly as written, once, with no redirect, pipe or other command added:\nsh ${path}\nThen return the exit code Bash printed for it, and the last 100 lines of its output, empty when it printed nothing. If the command did not run, return -1.`;
  // A thrown call (the agent stalled on every attempt) is a failed try, as null is.
  const ran: unknown = await rt.agent(prompt, { label: step.id, schema }).catch(() => null);
  return typeof ran === "object" && ran !== null && "exitCode" in ran && "output" in ran
    ? { exitCode: Number(ran.exitCode), output: String(ran.output) }
    : null;
};

/** A command or check step, run again while it fails, `retries` times at most. */
const runRetried = async (step: Step, state: State, rt: Runtime): Promise<Ran | null> => {
  let ran = await runCommand(step, state, rt);
  for (let tries = 0; tries < (step.retries ?? 0) && ran?.exitCode !== 0; tries += 1) {
    ran = await runCommand(step, state, rt);
  }
  return ran;
};

/** The first check of an agent step that fails after its own retries, or null when all pass. */
const failingCheck = async (step: Step, state: State, rt: Runtime): Promise<(Ran & { id: string }) | null> => {
  for (const id of step.checks ?? []) {
    const check = state.stage.steps.find((each) => each.id === id);
    const ran = check === undefined ? null : await runRetried(check, state, rt);
    if (ran === null || ran.exitCode !== 0) return { id, exitCode: ran?.exitCode ?? -1, output: ran?.output ?? "" };
  }
  return null;
};

/** A value as prompt text. */
const textOf = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value));

/** An agent step's agent, started again while it fails, `retries` times at most; null when every try failed. */
const attempt = async (step: Step, prompt: string, rt: Runtime): Promise<unknown> => {
  for (let tries = 0; tries <= (step.retries ?? 0); tries += 1) {
    const result: unknown = await rt.agent(prompt, step.options).catch(() => null);
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
    if (round === 2) state.unmet.add(failing.id);
    prompt = `${prompt}\n\nThe check ${failing.id} failed with exit code ${failing.exitCode}:\n${failing.output}\nFix the work so that it passes.`;
  }
  return false;
};

/** A command step's outputs; its output and exit code are kept. */
const commandOutputs = async (step: Step, state: State, rt: Runtime): Promise<string[]> => {
  const ran = await runRetried(step, state, rt);
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
    // Each command that goes on carries the inputs its stage takes, so the next stage needs no args from the user.
    const next = (step.next ?? []).map(({ command, inputs }) => {
      const carried = Object.fromEntries(
        inputs.flatMap((name) => (Object.hasOwn(state.inputs, name) ? [[name, state.inputs[name]]] : [])),
      );
      return Object.keys(carried).length === 0 ? command : `${command} ${JSON.stringify(carried)}`;
    });
    state.report.stops.push({ gate: step.id, message: step.message ?? "", next });
    return [];
  }
  return [{ start: "start", pass: "approved", join: "done", check: "done" }[step.kind]];
};

/** Settles one step: skipped unless all its control sources fired, else run. */
const settle = async (step: Step, state: State, rt: Runtime): Promise<void> => {
  if (state.ended || !step.run.every((key) => state.fired.has(key))) {
    (state.unmet.has(step.id) ? state.report.failed : state.report.skipped).push(step.id);
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
    ...argsOf(rt.args, stage),
    fired: new Set(stage.fired),
    values: new Map(),
    settled: new Set(stage.settled),
    report: { done: [], failed: [], skipped: [], stops: [], outputs: {} },
    ended: false,
    unmet: new Set(),
  };
  const ready = (): Step[] =>
    stage.steps.filter((step) => !state.settled.has(step.id) && step.after.every((id) => state.settled.has(id)));
  for (let wave = ready(); wave.length > 0; wave = ready()) {
    await rt.parallel(wave.slice(0, stage.concurrency).map((step) => () => settle(step, state, rt)));
  }
  const stuck = stage.steps.filter((step) => !state.settled.has(step.id)).map((step) => step.id);
  if (stuck.length > 0) throw new Error(`The steps ${stuck.join(", ")} wait on steps outside their stage.`);
  for (const [name, source] of Object.entries(stage.outputs)) state.report.outputs[name] = valueOf(state, source);
  return state.report;
};

/** The functions a stage script carries, in the order it declares them. */
const RUNNER = [
  objectOf,
  argsOf,
  valueOf,
  runCommand,
  runRetried,
  failingCheck,
  textOf,
  attempt,
  runAgent,
  commandOutputs,
  fire,
  settle,
  runStage,
];

/** A stage's workflow script: the meta block, the stage as data, the runner's functions, and the call that runs it. */
export const stageScript = (meta: { name: string; description: string }, stage: StageScript): string => {
  const functions = RUNNER.map((fn) => `const ${fn.name} = ${fn.toString()};`).join("\n\n");
  const data = `const STAGE = ${JSON.stringify(stage, null, 2)};`;
  return `export const meta = ${JSON.stringify(meta, null, 2)};\n\n${data}\n\n${functions}\n\nreturn await runStage(STAGE, { agent, parallel, args });\n`;
};
