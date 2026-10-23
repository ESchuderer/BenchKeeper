// The tier band's session state: the last tier line an answer wrote, and this session's override.
export type TierLine = { tier: string; changeType: string | null }

declare module 'claude-code' {
  interface PluginState {
    benchkeeper: { tier: TierLine | null; override: string | null }
  }
}
