// Optional tier band (userConfig tierBand, off by default): a row with the project, its branch, the last test result and
// Ponytail's level (when that plugin is on), a row with the tier line of the last answer and buttons for /benchkeeper:tier,
// the sessions board and the doctor, and the session's override kept in the system prompt, so it outlasts compaction and
// resume. It reads the working folder, git and one flag file of Ponytail; it writes nothing and sends nothing.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TierLine, Where } from '../../types'

export const TIER = /^Tier: (quick|standard|full|research)(?: \(([^)]+)\))?/gm
const CHOICES = ['quick', 'standard', 'full', 'research']
const tier = atom({ plugin: 'benchkeeper', key: 'tier' } as const, null)
const override = atom({ plugin: 'benchkeeper', key: 'override' } as const, null)
const where = atom({ plugin: 'benchkeeper', key: 'where' } as const, null)
const tests = atom({ plugin: 'benchkeeper', key: 'tests' } as const, null)
// The test commands the sessions board counts too (app/src/sessions.mjs).
const TEST = /(?:^|[\s;&|('"])(npm (?:run )?test|node --test|npx playwright test|pytest|go test|cargo test|vitest|jest)(?=$|[\s;&|):'"])/

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

// Project folder, git branch and Ponytail's level (the flag file its own hooks write; absent when it is not installed).
// Read after each answer, never while drawing.
async function refresh($: EngineInterface) {
  const cwd = await $.session.cwd()
  const git = await $.process.run(['git', 'branch', '--show-current'], { cwd }).catch(() => undefined)
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`
  const level = (await $.fs.read(`${dir}/.ponytail-active`).catch(() => '')).trim()
  const branch = git?.exitCode === 0 ? git.stdout.trim() : ''
  await update($, where, () => ({ project: cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || cwd, branch: branch || null, ponytail: /^[a-z-]{1,12}$/.test(level) ? level : null }))
}

// The board the app writes on each scan of its Sessions view, and on benchkeeper sessions board; the band only opens it.
async function openBoard($: EngineInterface) {
  const home = (await $.env.get('BENCHKEEPER_HOME')) ?? (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  const file = `${home}/.config/benchkeeper/board.html`
  if (!(await $.fs.exists(file))) return $.ui.toast('No sessions board yet: open Sessions in the BenchKeeper app, or run benchkeeper sessions board')
  const windows = (await $.env.get('OS')) === 'Windows_NT'
  const mac = !windows && (await $.process.run(['uname'])).stdout.trim() === 'Darwin'
  await $.process.run(windows ? ['cmd', '/c', 'start', '', file.replaceAll('/', '\\')] : [mac ? 'open' : 'xdg-open', file])
}

const HELP = 'BenchKeeper band. Top row: project, branch, last test run, Ponytail level. quick, standard, full set the tier of this session, auto lets each task choose. board opens the sessions board. doctor asks the agent to run benchkeeper doctor. Nothing leaves this machine. Turn off: set Tier band to false in the plugin options.'

export const register: Register = (on, options) => {
  const on_ = options.tierBand === true

  // Each step's visible text: the tier line comes before the first edit, not only in the final answer.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const line = on_ && !e.agentId ? lastTier(result.answer) : null
    if (line) await update($, tier, () => line)
    if (on_ && !e.agentId) await refresh($).catch(() => undefined)
    return result
  })

  // The last test run of the main loop, as the board reads it: a failed exit code fails, any other result passes. Never denies.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (on_ && !e.agentId && TEST.test(e.command) && ran.deny === undefined) {
      if (!ran.isError) await update($, tests, () => 'pass')
      else if (/Exit code [1-9]/.test(ran.text ?? '')) await update($, tests, () => 'fail')
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('session.start', async ($, e, next) => {
    if (on_) await refresh($).catch(() => undefined)
    return next(e)
  }).catch(($, e, next) => next(e))

  // /clear, /resume and /branch reset the band's atoms and do not fire session.start again.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    if (on_) await refresh($).catch(() => undefined)
    return next(e)
  }).catch(($, e, next) => next(e))

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
    const at = await read($, where)
    const last = await read($, tests)
    const pick = async (level: string) => {
      await $.command.run({ command: 'benchkeeper:tier', args: level })
      await setOverride($, level)
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    const info = [
      at?.project ? `${at.project}${at.branch ? ` (${at.branch})` : ''}` : null,
      `tests: ${last === 'pass' ? 'passed' : last === 'fail' ? 'failed' : 'not run yet'}`,
      at?.ponytail ? `Ponytail: ${at.ponytail}` : null,
    ].filter(Boolean).join('  ')
    const mine = (
      <Box flexDirection="column" width={e.props.bodyColumns}>
      <Text dimColor>{info}</Text>
      <Box flexDirection="row" alignItems="center" gap={2} width={e.props.bodyColumns}>
        <Text>Tier: {line ? `${line.tier}${line.changeType ? ` (${line.changeType})` : ''}` : 'none yet'}</Text>
        <Text dimColor>override: {v ?? 'none'}</Text>
        <Box flexGrow={1} />
        {['quick', 'standard', 'full', 'auto'].map(level => (
          <Button key={level} plain label={level} onPress={() => pick(level)} />
        ))}
        <Button key="board" plain label="board" onPress={() => openBoard($).catch(() => $.ui.toast('Could not open the sessions board'))} />
        <Button key="doctor" plain label="doctor" onPress={() => $.command.run({ command: 'benchkeeper:operating-benchkeeper', args: 'run benchkeeper doctor for this project and list the findings' }).catch(() => $.ui.toast('Could not start the doctor'))} />
        <Button key="help" plain label="?" onPress={() => $.ui.toast(HELP)} />
      </Box>
      </Box>
    )
    return below ? <Box flexDirection="column">{mine}{below}</Box> : mine
  })
}
