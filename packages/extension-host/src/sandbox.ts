/** How the host starts an extension's process. */
export type Launch = { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv };

/** What a sandbox lets an extension do: read its own folder, write nowhere, and reach no network (the host fetches). */
export type SandboxPolicy = { read: string[]; write: string[]; network: "none" };

/**
 * The OS sandbox a community extension runs in, on top of Node's permission flags, which do not hold against malicious
 * code (https://nodejs.org/api/permissions.html). It wraps a launch, or answers undefined where it cannot. Which
 * sandbox runs is owner question Q8; an implementation must pass the conformance kit of this package's tests.
 */
export type Sandbox = { wrap: (launch: Launch, policy: SandboxPolicy) => Launch | undefined };

/** The sandbox until Q8 is answered: it wraps nothing, so every community extension is refused. */
export const unavailable: Sandbox = { wrap: () => undefined };
