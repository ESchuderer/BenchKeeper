export type { Credentials, CredentialValue } from "./fetch.ts";
export {
  type ExtensionLaunch,
  HOST_LIMITS,
  type HostLimits,
  type RunLog,
  type RunningExtension,
  type RunRequest,
  speaks,
  startExtension,
  type Trust,
} from "./host.ts";
// The guard on an extension's output, for any reader of it.
export { framesUpTo } from "./reader.ts";
export { type Launch, type Sandbox, type SandboxPolicy, sandboxRuntime, unavailable } from "./sandbox.ts";
export { type Hop, type HopAnswer, isPublic, type Transport, transport } from "./transport.ts";
// Ends a process with its whole tree: a program host/exec runs, or a workflow's command.
export { stopTree } from "./tree.ts";
