import { type ActionContext, type DoctorFinding, HOST_MISSING } from "@cedarloom/extension-sdk";

/** The Orca version this extension and its recorded test outputs were checked with; another major is a warning. */
export const OBSERVED = "1.4.251";
// Below the doctor's 10 s for both calls: Orca's own status call gives up after 1 s.
const MS = 4000;
// Where the manifest names Orca's CLI. On Windows it is an orca.cmd, which only cmd.exe runs, and the host starts no
// shell (CVE-2024-27980).
const CHECKED = new Set(["darwin", "linux"]);

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
  // It exits 0 also when no app runs: another code is an error.
  if (status.code !== 0) throw new Error(`orca status --json exited with ${status.code}`);
  const answer: unknown = JSON.parse(status.stdout);
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

/**
 * The doctor's check: whether Orca is installed and running, and a warning for a major version not checked with or a
 * version it cannot read.
 */
export const doctor = async (context: Exec, platform: string = process.platform): Promise<DoctorFinding[]> => {
  if (!CHECKED.has(platform)) return [finding("info", "orca.unchecked", "Orca is not checked on this platform yet.")];
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
  if (major === undefined)
    return [state, finding("warning", "orca.unreadable", `Orca's version ${found.version} does not read.`)];
  if (major === majorOf(OBSERVED)) return [state];
  const unobserved = `Orca ${found.version} is a major version this CedarLoom was not checked with (${OBSERVED}).`;
  return [state, finding("warning", "orca.unobserved-major", unobserved)];
};

/** The status action: whether Orca is installed, its version, and whether it is running. */
export const status = async (context: Exec): Promise<Record<string, unknown>> => {
  const found = await probe(context);
  return found.installed ? { ...found } : { installed: false, running: false };
};
