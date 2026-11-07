import { type ExecParams, type ExecResult, HOST_MISSING } from "./protocol.ts";

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
