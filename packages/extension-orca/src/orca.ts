import { type ActionContext, type DoctorFinding, HOST_MISSING } from "@cedarloom/extension-sdk";

/** The Orca version this extension and its recorded test outputs were checked with; another major is a warning. */
export const OBSERVED = "1.4.251";
// Below the doctor's 10 s for both calls: Orca's own status call gives up after 1 s.
const MS = 4000;

type Exec = Pick<ActionContext, "exec">;
type Probe = { installed: false; reason: string } | { installed: true; version: string; running: boolean };

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const at = (value: unknown, ...keys: string[]): unknown =>
  keys.reduce((inner, key) => Reflect.get(Object(inner), key), value);
const majorOf = (version: string): string | undefined => /^v?(\d+)\.\d+/.exec(version)?.[1];

/**
 * Orca through its documented CLI, which the host finds (on Linux `orca-ide` or its shim, never a bare `orca`, which
 * there can be the GNOME screen reader): its version, and whether its app runs and its runtime answers.
 */
const probe = async ({ exec }: Exec): Promise<Probe> => {
  let version;
  try {
    version = await exec({ program: "orca", args: ["--version"], timeoutMs: MS });
  } catch (error) {
    if (at(error, "code") === HOST_MISSING) return { installed: false, reason: messageOf(error) };
    throw error;
  }
  if (version.code !== 0) throw new Error(`orca --version exited with ${version.code}`);
  const status = await exec({ program: "orca", args: ["status", "--json"], timeoutMs: MS });
  const answer: unknown = status.code === 0 ? JSON.parse(status.stdout) : null;
  const running =
    at(answer, "result", "app", "running") === true && at(answer, "result", "runtime", "reachable") === true;
  return { installed: true, version: version.stdout.trim(), running };
};

const finding = (severity: DoctorFinding["severity"], code: string, message: string): DoctorFinding => ({
  check: "orca",
  severity,
  code,
  message,
});

/** The doctor's check: whether Orca is installed and running, and a warning for a major version not checked with. */
export const doctor = async (context: Exec): Promise<DoctorFinding[]> => {
  let found: Probe;
  try {
    found = await probe(context);
  } catch (error) {
    return [finding("warning", "orca.unreadable", `Orca did not answer as expected: ${messageOf(error)}`)];
  }
  if (!found.installed) return [finding("info", "orca.missing", `Orca is not installed here (${found.reason}).`)];
  const state = found.running
    ? finding("info", "orca.running", `Orca ${found.version} is running.`)
    : finding("info", "orca.not-running", `Orca ${found.version} is installed and not running.`);
  const major = majorOf(found.version);
  if (major === undefined || major === majorOf(OBSERVED)) return [state];
  const unobserved = `Orca ${found.version} is a major version this CedarLoom was not checked with (${OBSERVED}).`;
  return [state, finding("warning", "orca.unobserved-major", unobserved)];
};

/** The status action: whether Orca is installed, its version, and whether it is running. */
export const status = async (context: Exec): Promise<Record<string, unknown>> => {
  const found = await probe(context);
  return found.installed ? { ...found } : { installed: false, running: false };
};
