// The tier band's session state: the last tier line an answer wrote, this session's override, where the session runs and
// its last test result.
export type TierLine = { tier: string; changeType: string | null }
export type Where = { project: string; branch: string | null; ponytail: string | null }

declare module 'claude-code' {
  interface PluginState {
    benchkeeper: { tier: TierLine | null; override: string | null; where: Where | null; tests: 'pass' | 'fail' | null }
  }
}
