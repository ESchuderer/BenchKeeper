import { execFile } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { getDefaultWritePaths, SandboxManager } from "@anthropic-ai/sandbox-runtime";

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
const run = promisify(execFile);

// What Node needs to start besides its own binary. Linux: the system's programs and libraries, srt's shell and `env`
// among them. macOS maps its own libraries from the shared cache; Node reads its OpenSSL configuration at start (the
// official build from /System/Library/OpenSSL, Homebrew's from its prefix), and Homebrew's loads its kegs. A Node
// installed elsewhere fails the probe with the path it was refused.
// shortcut: srt opens no link to the time zone (/etc/localtime, and on macOS /etc itself), so without TZ an extension
// tells time in UTC; pass the host's zone once an extension needs local time.
const SYSTEM: Partial<Record<NodeJS.Platform, string[]>> = {
  linux: ["/usr", "/bin", "/lib", "/lib64", "/etc/ld.so.cache"],
  darwin: [
    "/System/Library/OpenSSL",
    ...["/opt/homebrew", "/usr/local"].flatMap((prefix) =>
      ["Cellar", "opt", "etc/openssl@3", "etc/openssl@4"].map((path) => `${prefix}/${path}`),
    ),
  ],
};

// One initialization per process: srt's proxies serve every wrapped launch, and no allowed host lets them pass anything.
let ready: Promise<void> | undefined;
// Whether a program starts inside srt at all, checked once per program: srt's own checks pass where bubblewrap lacks
// the rights it needs (a rootless container, Ubuntu's AppArmor profile), or a library lies outside SYSTEM.
const probes = new Map<string, Promise<void>>();

// srt's own install (the folder above its dist/index.js): bubblewrap runs its seccomp helper from there.
const srt = dirname(dirname(fileURLToPath(import.meta.resolve("@anthropic-ai/sandbox-runtime"))));

// The launch inside srt: all of `/` hidden but the policy's reads, the binary, srt's install and SYSTEM; writes to the
// policy's only. The process gets exactly the launch's environment (env -i): srt's shells add names of their own, and
// on macOS a shell of its wrapper ran the user's startup file, whose exports reached the process.
const confined = async (launch: Launch, policy: SandboxPolicy): Promise<Launch> => {
  const allowRead = [...policy.read, launch.command, srt, ...(SYSTEM[process.platform] ?? [])];
  // srt opens its own temp folder (/tmp/claude) and a few folders in the home folder for writing in every sandbox: a
  // channel between extensions, and into Claude Code's. Only stdio stays writable.
  const denyWrite = getDefaultWritePaths().filter((path) => !path.startsWith("/dev/"));
  const filesystem = { denyRead: ["/"], allowRead, allowWrite: policy.write, denyWrite };
  const environment = Object.entries(launch.env).filter(([, value]) => value !== undefined);
  const assignments = environment.map(([name, value]) => `${name}=${String(value)}`);
  const command = ["/usr/bin/env", "-i", ...assignments, launch.command, ...launch.args].map(quoted).join(" ");
  const { argv } = await SandboxManager.wrapWithSandboxArgv(command, undefined, { filesystem }, undefined, launch.cwd);
  const [wrapper = "", ...args] = argv;
  return { ...launch, command: wrapper, args };
};

// The program with `-e ''` (Node's empty script) inside srt; when it does not start, its error output says why.
const probe = async (command: string): Promise<void> => {
  const nothing = await confined(
    { command, args: ["-e", ""], cwd: "/", env: {} },
    { read: [], write: [], network: "none" },
  );
  await run(nothing.command, nothing.args, { cwd: "/", env: {}, timeout: 30_000 }).catch((error: unknown) => {
    const output = String(Reflect.get(Object(error), "stderr") ?? "").trim();
    throw new Error(`${command} does not start inside the OS sandbox here: ${output || String(error)}`);
  });
};

/**
 * The OS sandbox of `@anthropic-ai/sandbox-runtime`, the sandbox of Claude Code (Q8), pinned exactly: sandbox-exec on
 * macOS, bubblewrap on Linux (with socat and ripgrep). On Windows its sandbox needs an elevated install of its own, so
 * it wraps nothing there, nor where its programs are missing or it warns of a weaker sandbox. Where the launch's
 * program does not start inside it, the wrap fails with that program's error.
 *
 * A process inside reaches no network: srt's proxies, set up with no allowed host, refuse every request, and no Unix
 * socket outside. It reads only the policy's paths, its own binary and the system's (SYSTEM), writes only the policy's
 * paths, and cannot signal a process outside.
 */
export const sandboxRuntime = (platform: NodeJS.Platform = process.platform): Sandbox => ({
  wrap: async (launch, policy) => {
    // A warning is a weaker sandbox: on Linux without srt's seccomp helper, Unix sockets outside stay open.
    const checks =
      platform === "win32"
        ? undefined
        : SandboxManager.isSupportedPlatform() && (await SandboxManager.checkDependenciesAsync());
    if (!checks || checks.errors.length + checks.warnings.length > 0) return undefined;
    ready ??= SandboxManager.initialize({
      network: { allowedDomains: [], deniedDomains: [] },
      filesystem: { denyRead: [], allowRead: [], allowWrite: [], denyWrite: [] },
    });
    await ready;
    const starts = probes.get(launch.command) ?? probe(launch.command);
    probes.set(launch.command, starts);
    await starts;
    return confined(launch, policy);
  },
});
