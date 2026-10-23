// Optional tier band (userConfig tierBand, off by default): the tier line of the last answer above the prompt, buttons
// for /benchkeeper:tier and the sessions board, and the session's override kept in the system prompt, so it outlasts
// compaction and resume.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TierLine } from '../../types'

export const TIER = /^Tier: (quick|standard|full|research)(?: \(([^)]+)\))?/gm
const CHOICES = ['quick', 'standard', 'full', 'research']
const tier = atom({ plugin: 'benchkeeper', key: 'tier' } as const, null)
const override = atom({ plugin: 'benchkeeper', key: 'override' } as const, null)

// The last tier line in a text, or null.
export function lastTier(text: string): TierLine | null {
  const m = [...text.matchAll(TIER)].at(-1)
  return m ? { tier: m[1] ?? '', changeType: m[2] ?? null } : null
}

// Per session in the plugin's store, so a resumed session finds its override again.
const key = async ($: EngineInterface) => `override:${await $.session.id()}`
// A tier sets the override, auto ends it; anything else leaves it, as the skill then asks which tier was meant.
async function setOverride($: EngineInterface, value: string) {
  const v = value.trim().toLowerCase()
  if (CHOICES.includes(v)) await $.store.set(await key($), v)
  else if (v === 'auto') await $.store.delete(await key($))
  else return
  await update($, override, () => (v === 'auto' ? null : v))
}
async function current($: EngineInterface): Promise<string | null> {
  const v = await read($, override)
  if (v) return v
  const stored = await $.store.get(await key($))
  return typeof stored === 'string' && CHOICES.includes(stored) ? stored : null
}

// The board the app writes on each scan of its Sessions view, and on benchkeeper board; the band only opens it.
async function openBoard($: EngineInterface) {
  const home = (await $.env.get('BENCHKEEPER_HOME')) ?? (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  const file = `${home}/.config/benchkeeper/board.html`
  if (!(await $.fs.exists(file))) return $.ui.toast('No sessions board yet: open Sessions in the BenchKeeper app, or run benchkeeper board')
  const windows = (await $.env.get('OS')) === 'Windows_NT'
  const mac = !windows && (await $.process.run(['uname'])).stdout.trim() === 'Darwin'
  await $.process.run(windows ? ['cmd', '/c', 'start', '', file] : [mac ? 'open' : 'xdg-open', file])
}

export const register: Register = (on, options) => {
  const on_ = options.tierBand === true

  // Each step's visible text: the tier line comes before the first edit, not only in the final answer.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (!on_ || e.agentId) return result
    const line = lastTier(result.answer)
    if (line) await update($, tier, () => line)
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    if (on_ && e.command?.name === 'benchkeeper:tier') await setOverride($, e.command.args)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    const v = on_ ? await current($) : null
    if (!v) return result
    const text = `Tier override for this session (set with /benchkeeper:tier): ${v}. Run each task at this tier and write its tier line as \`Tier: ${v} (override)\`, unless the user names a tier for the task or the change is risky.`
    return { sections: [...result.sections, { id: 'benchkeeper:tier', text, scope: 'session' }] }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!on_ || e.props.hasSurvey) return next(e)
    // Other mods share this slot: theirs draw below. next(e) rejects only when nothing answers beneath (a test).
    const below = await next(e).catch(() => undefined)
    const line = await read($, tier)
    const v = await current($)
    const pick = async (level: string) => {
      await $.command.run({ command: 'benchkeeper:tier', args: level })
      await setOverride($, level)
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    const mine = (
      <Box flexDirection="row" alignItems="center" gap={2} width={e.props.bodyColumns}>
        <Text>Tier: {line ? `${line.tier}${line.changeType ? ` (${line.changeType})` : ''}` : 'none yet'}</Text>
        <Text dimColor>override: {v ?? 'none'}</Text>
        <Box flexGrow={1} />
        {['quick', 'standard', 'full', 'auto'].map(level => (
          <Button key={level} plain label={level} onPress={() => pick(level)} />
        ))}
        <Button key="board" plain label="board" onPress={() => openBoard($).catch(() => $.ui.toast('Could not open the sessions board'))} />
      </Box>
    )
    return below ? <Box flexDirection="column">{mine}{below}</Box> : mine
  })
}
