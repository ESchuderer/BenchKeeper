// The tier band's session state: the last tier line an answer wrote, this session's override, where the session runs and
// its last test run and lint or type check, each with the edits since.
export type TierLine = { tier: string; changeType: string | null }
export type Where = { project: string; branch: string | null; ponytail: string | null }
export type Check = { result: 'pass' | 'fail'; edits: number }

declare module 'claude-code' {
  interface PluginState {
    benchkeeper: { tier: TierLine | null; override: string | null; where: Where | null; tests: Check | null; lint: Check | null }
  }
}
