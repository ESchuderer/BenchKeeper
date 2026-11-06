import { spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { dirname } from "node:path";
import { SandboxManager } from "@anthropic-ai/sandbox-runtime";

/** How the host starts an extension's process. */
export type Launch = { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv };

/** What a sandbox lets an extension do: read its own folder, write nowhere, and reach no network (the host fetches). */
export type SandboxPolicy = { read: string[]; write: string[]; network: "none" };

/**
 * The OS sandbox a community extension runs in, on top of Node's permission flags, which do not hold against malicious
 * code (https://nodejs.org/api/permissions.html). It wraps a launch, or answers undefined where it cannot. An
 * implementation must pass the conformance kit of this package's tests.
 */
export type Sandbox = { wrap: (launch: Launch, policy: SandboxPolicy) => Promise<Launch | undefined> };

/** A sandbox that wraps nothing, so every community extension is refused. */
export const unavailable: Sandbox = { wrap: () => Promise.resolve(undefined) };

// A word the shell takes as it is: in single quotes, each single quote closed, escaped and opened again.
const quoted = (word: string): string => `'${word.replaceAll("'", `'\\''`)}'`;

// One initialization per process: srt's proxies serve every wrapped launch, and no allowed host lets them pass anything.
let ready: Promise<void> | undefined;
// Whether a sandboxed process starts here at all, checked once per process: in a container without the rights
// bubblewrap needs (to mount /dev/pts and /proc), or under a kernel that withholds user namespaces, srt's own checks pass
// and only a run shows it.
let starts: Promise<boolean> | undefined;

// The launch inside srt, with the policy's reads and writes; the runtime's own install stays readable.
const confined = async (launch: Launch, policy: SandboxPolicy): Promise<Launch> => {
  const allowRead = [...policy.read, dirname(dirname(launch.command))];
  const filesystem = { denyRead: [homedir()], allowRead, allowWrite: policy.write, denyWrite: [] };
  const command = [launch.command, ...launch.args].map(quoted).join(" ");
  const { argv } = await SandboxManager.wrapWithSandboxArgv(command, undefined, { filesystem }, undefined, launch.cwd);
  const [wrapper = "", ...args] = argv;
  return { ...launch, command: wrapper, args };
};

const probe = async (): Promise<boolean> => {
  const nothing = { command: process.execPath, args: ["-e", ""], cwd: tmpdir(), env: {} };
  const { command, args } = await confined(nothing, { read: [], write: [], network: "none" });
  return spawnSync(command, args, { cwd: tmpdir(), env: {}, stdio: "ignore", timeout: 30_000 }).status === 0;
};

/**
 * The OS sandbox of `@anthropic-ai/sandbox-runtime`, the sandbox of Claude Code (Q8), pinned exactly: sandbox-exec on
 * macOS, bubblewrap on Linux (with socat and ripgrep). On Windows its sandbox needs an elevated install of its own, so
 * it wraps nothing there, nor where its programs are missing or a sandboxed process does not start.
 *
 * A process inside reaches no network: srt's proxies, set up with no allowed host, refuse every request. It writes
 * only the policy's paths, reads nothing of the user's home folder but the policy's paths and the runtime's own
 * install (a version manager keeps Node there), and cannot signal a process outside.
 */
export const sandboxRuntime = (platform: NodeJS.Platform = process.platform): Sandbox => ({
  wrap: async (launch, policy) => {
    const runs =
      platform !== "win32" &&
      SandboxManager.isSupportedPlatform() &&
      (await SandboxManager.checkDependenciesAsync()).errors.length === 0;
    if (!runs) return undefined;
    ready ??= SandboxManager.initialize({
      network: { allowedDomains: [], deniedDomains: [] },
      filesystem: { denyRead: [], allowRead: [], allowWrite: [], denyWrite: [] },
    });
    await ready;
    starts ??= probe();
    return (await starts) ? confined(launch, policy) : undefined;
  },
});
