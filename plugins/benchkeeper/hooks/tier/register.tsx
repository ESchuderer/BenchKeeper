// Optional tier band (userConfig tierBand, off by default): a row with the project, its branch and Ponytail's level (when that
// plugin is on), a row with the last test run, the last lint or type check and whether the tier's checks passed since the
// last edit, a row with the tier line of the last answer and buttons for /benchkeeper:tier, the sessions board and the
// doctor, and the session's override kept in the system prompt and the plugin's store, so it outlasts compaction and resume.
// It reads the working folder, git, one flag file of Ponytail and the commands and edits of the main loop; it writes only
// that override to the plugin's store and sends nothing.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Check, TierLine, Where } from '../../types'

export const TIER = /^Tier: (quick|standard|full|research)(?: \(([^)]+)\))?/gm
const CHOICES = ['quick', 'standard', 'full', 'research']
const tier = atom({ plugin: 'benchkeeper', key: 'tier' } as const, null)
const override = atom({ plugin: 'benchkeeper', key: 'override' } as const, null)
const where = atom({ plugin: 'benchkeeper', key: 'where' } as const, null)
const tests = atom({ plugin: 'benchkeeper', key: 'tests' } as const, null)
const lint = atom({ plugin: 'benchkeeper', key: 'lint' } as const, null)
// A command list as found anywhere in a command, and as the start of one part of a chain, also after a runner (npx vitest).
const commands = (list: string) => ({
  any: new RegExp(`(?:^|[\\s;&|('"])${list}(?=$|[\\s;&|):'"])`),
  start: new RegExp(`^(?:\\w+=\\S+\\s+)*(?:(?:npx|pnpm(?: exec)?|yarn|bunx|uv run|python3? -m)\\s+)?${list}(?=$|\\s)`),
})
// The test commands the sessions board counts too (app/src/sessions.mjs).
const TEST = commands('(?:(?:npm|pnpm|yarn|bun) (?:run )?test(?::\\S+)?|node --test|playwright test|pytest|go test|cargo test|vitest|jest)')
const LINT = commands('(?:eslint|npm run lint|tsc|ruff|mypy|pyright|go vet|cargo clippy|biome)')
const EDITS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']

// The commands of a chain joined by && only, else none: with ||, ;, | or & the exit code can come from another command, and a
// quoted name (echo "npm test") runs no test.
const chain = (command: string) => (/[;|&\n`]|\$\(/.test(command.replaceAll('&&', ' ')) ? [] : command.split('&&').map((part) => part.trim()))
// Without its redirections (> log, 2>&1, &> log), which leave the exit code alone.
const plain = (command: string) => command.replace(/\s*(?:&>>?|\d*>>?)\s*(?:&\d+|[^\s;&|'"]+)/g, '')
// The script of one sh -c '<script>', alone or after a container exec (devcontainer exec ... sh -lc 'cd app && npm test'),
// else the command: in echo sh -c 'npm test' the shell is an argument.
function script(command: string) {
  const c = plain(command)
  return plain(c.match(/^(?:\w+=\S+\s+)*(?:(?:devcontainer|docker|podman)(?: compose)? exec\s(?:[^;&|`'"(]*\s)?)?(?:\/(?:usr\/)?bin\/)?(?:ba)?sh -[a-z]*c (['"])([^'"]*)\1$/)?.[2] ?? c)
}

// The result of a check run, as the board reads a test run: a failed exit code fails, any other result passes. A compound
// command, a failed chain or a background run has no result of its own (null). undefined leaves the last result.
function outcome(check: typeof TEST, command: string, ran: { isError?: boolean; text?: string; backgroundTaskId?: unknown }) {
  if (!check.any.test(plain(command))) return undefined
  const parts = chain(script(command))
  // A chain passes when every part passed. It fails for the check only when the check is the whole command: in cd x && npm test
  // or false && npm test the failure may be another part's, and in npm test && false the test passed.
  if (!parts.some((part) => check.start.test(part)) || ran.backgroundTaskId) return null
  if (!ran.isError) return 'pass'
  if (parts.length > 1) return null
  return /Exit code [1-9]/.test(ran.text ?? '') ? 'fail' : undefined
}

const state = (check: Check | null) => (!check ? 'not run' : check.edits ? `stale (${check.edits} edit${check.edits > 1 ? 's' : ''} since)` : check.result === 'pass' ? 'passed' : 'failed')

// What the tier asks for before pushing (the playbook table of the workflow skill): quick the fast checks, standard and full
// the tests and a review, which no hook sees. Only results after the last edit count. Research and no tier: no verdict.
function verdict(tier: string | null, testRun: Check | null, lintRun: Check | null): string | null {
  if (tier !== 'quick' && tier !== 'standard' && tier !== 'full') return null
  const t = testRun?.edits === 0 ? testRun.result : null
  const l = lintRun?.edits === 0 ? lintRun.result : null
  const missing = [t === 'fail' && 'tests', l === 'fail' && 'lint/types'].filter(Boolean)
  if (tier === 'quick' ? !t && !l : !t) missing.push(tier === 'quick' ? 'tests or lint/types' : 'tests')
  if (missing.length) return `checks needed: ${missing.join(', ')}`
  return tier === 'quick' ? 'ready' : 'ready, review is yours'
}

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

const HELP = 'BenchKeeper band. Top row: project, branch, Ponytail level. Second row: last test run and lint or type check, stale after an edit, and ready when the checks the tier asks for passed since the last edit. quick, standard, full set the tier of this session, auto lets each task choose. board opens the sessions board. doctor asks the agent to run benchkeeper doctor. Nothing leaves this machine. Turn off: set Tier band to false in the plugin options.'

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

  // The last test run and lint or type check of the main loop. Never denies.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (on_ && !e.agentId && ran.deny === undefined) {
      const testRun = outcome(TEST, e.command, ran)
      const lintRun = outcome(LINT, e.command, ran)
      if (testRun !== undefined) await update($, tests, () => (testRun && { result: testRun, edits: 0 }))
      if (lintRun !== undefined) await update($, lint, () => (lintRun && { result: lintRun, edits: 0 }))
    }
    return ran
  }).catch(($, e, next) => next(e))

  // An edit of the main loop makes the results before it stale; a denied or failed edit changed nothing.
  on('tool.call', { tool: EDITS }, async ($, e, next) => {
    const ran = await next(e)
    if (on_ && !e.agentId && ran.deny === undefined && !ran.isError) {
      const stale = (c: Check | null) => (c ? { ...c, edits: c.edits + 1 } : null)
      await update($, tests, stale)
      await update($, lint, stale)
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
    const testRun = await read($, tests)
    const lintRun = await read($, lint)
    const ready = verdict(v ?? line?.tier ?? null, testRun, lintRun)
    const pick = async (level: string) => {
      await $.command.run({ command: 'benchkeeper:tier', args: level })
      await setOverride($, level)
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    const info = [
      at?.project ? `${at.project}${at.branch ? ` (${at.branch})` : ''}` : null,
      at?.ponytail ? `Ponytail: ${at.ponytail}` : null,
    ].filter(Boolean).join('  ')
    const mine = (
      <Box flexDirection="column" width={e.props.bodyColumns}>
      {info ? <Text dimColor>{info}</Text> : null}
      <Text>tests: {state(testRun)}  lint/types: {state(lintRun)}{ready ? `  ${ready}` : ''}</Text>
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
