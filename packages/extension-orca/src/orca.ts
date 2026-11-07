import { type ActionContext, type DoctorFinding, HOST_MISSING } from "@cedarloom/extension-sdk";

/** The Orca version this extension and its recorded test outputs were checked with; another major is a warning. */
export const OBSERVED = "1.4.251";
// Well below the doctor's 10 s for all three calls: Orca's own status call gives up after 1 s.
const MS = 2500;
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

// Orca's skills a Claude Code session of an Orca worker needs; Orca installs them, CedarLoom never does.
const SKILLS = ["orca-cli", "orchestration"];

// Which of them Claude Code lacks, by the list of Orca's running app (its CLI asks the app).
const missingSkills = async ({ exec }: Exec): Promise<string[]> => {
  const listed = await exec({ program: "orca", args: ["skills", "installed", "--json"], timeoutMs: MS });
  if (listed.code !== 0) throw new Error(`orca skills installed --json exited with ${listed.code}`);
  const skills: unknown = at(JSON.parse(listed.stdout), "result", "skills");
  if (!Array.isArray(skills)) throw new Error("orca skills installed --json lists no skills");
  const forClaude = skills.filter((skill) => [at(skill, "providers")].flat().includes("claude"));
  return SKILLS.filter((name) => !forClaude.some((skill) => at(skill, "name") === name));
};

const finding = (severity: DoctorFinding["severity"], code: string, message: string): DoctorFinding => ({
  check: "orca",
  severity,
  code,
  message,
});

// A warning for a major version not checked with or a version that does not read.
const versionWarnings = (version: string): DoctorFinding[] => {
  const major = majorOf(version);
  if (major === undefined) return [finding("warning", "orca.unreadable", `Orca's version ${version} does not read.`)];
  if (major === majorOf(OBSERVED)) return [];
  const unobserved = `Orca ${version} is a major version this CedarLoom was not checked with (${OBSERVED}).`;
  return [finding("warning", "orca.unobserved-major", unobserved)];
};

// While Orca runs: the command that installs the skills Claude Code lacks.
const skillFindings = async (context: Exec): Promise<DoctorFinding[]> => {
  let missing: string[];
  try {
    missing = await missingSkills(context);
  } catch (error) {
    const unread = `Orca's skills did not list as expected: ${messageOf(error)}`;
    return [finding("warning", "orca.skills-unreadable", unread)];
  }
  if (missing.length === 0) return [];
  const command = ["orca skills install", ...missing.map((name) => `--skill ${name}`)].join(" ");
  return [finding("info", "orca.skills-missing", `Claude Code lacks Orca's ${missing.join(", ")}: run ${command}.`)];
};

/**
 * The doctor's check: whether Orca is installed and running, a warning for a major version not checked with or a
 * version it cannot read, and while it runs, the command for the Orca skills Claude Code lacks.
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
  const skills = found.running ? await skillFindings(context) : [];
  return [state, ...versionWarnings(found.version), ...skills];
};

/** The status action: whether Orca is installed, its version, and whether it is running. */
export const status = async (context: Exec): Promise<Record<string, unknown>> => {
  const found = await probe(context);
  return found.installed ? { ...found } : { installed: false, running: false };
};
