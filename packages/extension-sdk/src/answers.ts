import { type ExecParams, type ExecResult, HOST_MISSING } from "./protocol.ts";

/** A program's JSON answer on its standard output; one that does not parse throws, by its exit code when it failed. */
export const jsonAnswer = (command: string, { code, stdout }: ExecResult): unknown => {
  try {
    const answer: unknown = JSON.parse(stdout);
    return answer;
  } catch (error) {
    // A failing run's exit code says more than its empty output.
    throw new Error(code === 0 ? `${command}: no JSON answer` : `${command} exited with ${code}`, { cause: error });
  }
};

/** The value at a path of keys in a parsed answer; undefined where the path leads nowhere. */
export const valueAt = (value: unknown, ...keys: string[]): unknown =>
  keys.reduce((inner, key) => Reflect.get(Object(inner), key), value);

/** An installed program's `--version` text, or why it is not installed here (none of the manifest's candidates found). */
export type ProgramVersion = { installed: false; reason: string } | { installed: true; version: string };

/** A program's `--version` answer through the host's `exec`; another exit code, or another refusal, throws. */
export const programVersion = async (
  exec: (request: ExecParams) => Promise<ExecResult>,
  program: string,
  timeoutMs: number,
): Promise<ProgramVersion> => {
  let answer;
  try {
    answer = await exec({ program, args: ["--version"], timeoutMs });
  } catch (error) {
    if (valueAt(error, "code") === HOST_MISSING) return { installed: false, reason: String(valueAt(error, "message")) };
    throw error;
  }
  if (answer.code !== 0) throw new Error(`${program} --version exited with ${answer.code}`);
  return { installed: true, version: answer.stdout.trim() };
};

/** A word as a POSIX shell takes it unchanged: in single quotes, each single quote closed, escaped and opened again. */
export const shellWord = (word: string): string => `'${word.replaceAll("'", `'\\''`)}'`;
