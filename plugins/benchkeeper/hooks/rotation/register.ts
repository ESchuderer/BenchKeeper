// Coordinator context rotation (orchestrating-projects): when the session's project root holds the coordinator's handoff
// file and the file names this session's Orca terminal, an idle Stop above the plugin's threshold clears the context
// with /clear and submits a resume prompt, and a clear or compaction hands the file back to the model. Otherwise every hook
// here passes. It reads and writes that one file and sends nothing.
import type { EngineInterface, Register } from 'claude-code'

import { FILE, RUNS, mine, restored } from './handoff.mjs'

const OPEN = '<!-- benchkeeper:status -->'
const CLOSE = '<!-- /benchkeeper:status -->'
// A second /clear while the restore hook of the first still runs cuts that hook off and loses its context.
const GAP_MS = 10 * 60 * 1000
const resume = (size: string) => `BenchKeeper cleared this coordinator's context at ${size} to save tokens. Run the Resume steps of the handoff file in your context now, before anything else, then continue from its Next section.`

// Per Claude Code process: the module stays loaded across /clear.
let running = false
// Set while a Stop awaits its checks, so a second Stop meanwhile cannot schedule a second clear.
let deciding = false
let lastEnd: number | null = null
let noted = false
// Main-loop turns started in this process: a turn that starts between the decision and the clear makes it stale.
let turns = 0

// The text with its status block holding only this line, the block appended when the text has none.
export function withStatus(text: string, line: string): string {
  const block = `${OPEN}\n${line}\n${CLOSE}`
  const start = text.lastIndexOf(OPEN)
  const end = start < 0 ? -1 : text.indexOf(CLOSE, start)
  if (end < 0) return `${text.trimEnd()}\n\n${block}\n`
  return text.slice(0, start) + block + text.slice(end + CLOSE.length)
}

const handoff = async ($: EngineInterface) => `${await $.session.root()}/${FILE}`

// The handoff file's text when it is this session's, else null. A -p child of the coordinator's shell inherits its
// ORCA_TERMINAL_HANDLE but draws on no surface, so it never counts as the coordinator.
async function own($: EngineInterface) {
  if ((await $.session.surfaces()).length === 0) return null
  const text = await $.fs.read(await handoff($)).catch(() => null)
  return text !== null && mine(String(text), await $.env.get('ORCA_TERMINAL_HANDLE')) ? String(text) : null
}
const slashes = (path?: string) => path?.replaceAll('\\', '/')

// Whether the file is the coordinator's own, not one a repository commits or a link leads to: a regular file reached
// through no link, in a git work tree whose .benchkeeper/runs git tracks nothing in. Any git failure refuses, so a broken
// repository or one git distrusts (another owner) never counts as untracked.
async function safe($: EngineInterface) {
  try {
    const root = await $.session.root()
    const [folder, file] = await Promise.all([$.fs.stat(root, { resolve: true }), $.fs.stat(await handoff($), { resolve: true })])
    if (file.kind !== 'file' || file.isLink || slashes(file.realPath) !== `${slashes(folder.realPath)}/${FILE}`) return false
    const git = await $.process.run(['git', '-c', 'core.fsmonitor=false', 'ls-files', '--', RUNS], { cwd: root })
    return git.exitCode === 0 && git.stdout === ''
  } catch {
    return false
  }
}
const vetted = async ($: EngineInterface) => {
  const text = await own($)
  return text !== null && (await safe($)) ? text : null
}
const stamp = (ms: number) => new Date(ms).toISOString()

// Rewrites the status line of the vetted handoff text.
async function status($: EngineInterface, text: string, event: string, tokens: number | undefined) {
  const context = tokens === undefined ? 'unread' : `${tokens} tokens`
  await $.fs.write(await handoff($), withStatus(text, `${stamp(await $.clock.now())} ${event}; context: ${context}; last clear: ${lastEnd === null ? 'none' : stamp(lastEnd)}`))
}

// A row of the transcript the person sees and the model does not read.
const note = ($: EngineInterface, text: string) => $.session.append({ message: { type: 'system', content: [{ type: 'text', text }] } })

async function rotate($: EngineInterface, size: string, now: number, seen: number, before: number | null) {
  // A prompt queued during the judged turn (an Orca wake) has started a new one: give up and let its Stop judge again.
  if (turns !== seen) {
    lastEnd = before
    return
  }
  running = true
  try {
    await $.command.run({ command: 'clear' })
    const submitted = await $.prompt.submit({ text: resume(size) })
    if (submitted.drop !== undefined) throw new Error(`the resume prompt was dropped: ${submitted.drop}`)
  } catch (error) {
    await note($, `BenchKeeper could not clear and resume this coordinator: ${error instanceof Error ? error.message : String(error)}`).catch(() => undefined)
  } finally {
    lastEnd = await $.clock.now().catch(() => now)
    running = false
  }
}

// The checks that need the engine, once the turn is known to be idle; schedules the clear when it is due.
async function decide($: EngineInterface, atTokens: number, atPercent: number) {
  const now = await $.clock.now()
  if (lastEnd !== null && now - lastEnd < GAP_MS) return
  const text = await own($)
  if (text === null) return
  const { context } = await $.session.usage()
  const figure = atPercent > 0 ? context.percent : context.tokens
  if (figure === undefined) {
    if (!noted) {
      noted = true
      await note($, 'BenchKeeper cannot read the context size of this session, so it will not clear this coordinator at its threshold.')
      if (await safe($)) await status($, text, 'usage unread', context.tokens).catch(() => undefined)
    }
    return
  }
  if (figure < (atPercent > 0 ? atPercent : atTokens)) return
  if (!(await safe($))) return
  const size = atPercent > 0 ? `${figure}% of its context window` : `${figure} tokens`
  await status($, text, `clearing at ${size}`, context.tokens).catch(() => undefined)
  // The gap starts now, so a timer that never fires cannot let a second clear through.
  const before = lastEnd
  lastEnd = now
  // A command run from the Stop hook would wait on the turn the hook holds. The timer runs it once the hook has returned,
  // a second later, so a prompt queued during the turn starts first and the clear gives up.
  const seen = turns
  $.clock.after(1000, () => void rotate($, size, now, seen, before))
}

export const register: Register = (on, options) => {
  const atTokens = typeof options.rotateAtTokens === 'number' ? options.rotateAtTokens : 200000
  const atPercent = typeof options.rotateAtPercent === 'number' ? options.rotateAtPercent : 0

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) turns++
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.SessionStart', { source: ['clear', 'compact'] }, async ($, e, next) => {
    const result = await next(e)
    const text = await vetted($)
    if (text === null) return result
    return { ...result, additionalContext: [...(result.additionalContext ?? []), restored(text)] }
  }).catch(($, e, next) => next(e))

  on('classic.PreCompact', async ($, e, next) => {
    if (!e.agent_id) {
      const text = await vetted($)
      const usage = await $.session.usage().catch(() => null)
      if (text !== null) await status($, text, 'compacting', usage?.context.tokens).catch(() => undefined)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    // A background task, a Stop hook's re-prompt or a hook that blocked the stop means the turn is not idle. Session crons
    // (e.session_crons) are future wakes that survive /clear, not work in flight, so they do not hold rotation back.
    if (e.agent_id || e.stop_hook_active || !Array.isArray(e.background_tasks) || e.background_tasks.length || running || deciding) return result
    if (result.block !== undefined || result.preventContinuation) return result
    if (atPercent <= 0 && atTokens <= 0) return result
    deciding = true
    try {
      await decide($, atTokens, atPercent)
    } finally {
      deciding = false
    }
    return result
  }).catch(($, e, next) => next(e))
}
