import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export type Call = { prompt: string; options: Record<string, unknown> | undefined };

const parallel = (thunks: (() => Promise<unknown>)[]): Promise<unknown[]> =>
  Promise.all(thunks.map((thunk) => thunk()));

// Runs a stage's script as the workflow runtime does: its body in an async function, with agent, parallel and the args
// a stage skill passes, the plugin's folder and the inputs.
export const runScript = async (
  script: string,
  answer: (call: Call) => unknown,
  inputs: object = {},
): Promise<[unknown, Call[]]> => {
  const folder = mkdtempSync(join(tmpdir(), "cedarloom-emitter-"));
  try {
    const file = join(folder, "stage.mjs");
    writeFileSync(
      file,
      `export default async (agent, parallel, args) => {\n${script.replace("export const meta", "const meta")}\n};\n`,
    );
    const module: { default: (...given: unknown[]) => Promise<unknown> } = await import(pathToFileURL(file).href);
    const calls: Call[] = [];
    const agent = async (prompt: string, options?: Record<string, unknown>): Promise<unknown> => {
      calls.push({ prompt, options });
      return answer({ prompt, options });
    };
    return [await module.default(agent, parallel, JSON.stringify({ root: "/plugin", inputs })), calls];
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
};

// A stage's report: the steps that ran, failed and were skipped, with no stop and no output unless `more` says.
export const report = (done: string[], failed: string[] = [], skipped: string[] = [], more: object = {}): object => ({
  done,
  failed,
  skipped,
  stops: [],
  outputs: {},
  ...more,
});

export const passing = { exitCode: 0, output: "ok" };
