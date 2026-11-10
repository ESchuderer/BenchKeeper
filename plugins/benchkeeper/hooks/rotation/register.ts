// Coordinator context rotation (orchestrating-projects): when the session's working folder holds the coordinator's handoff
// file, an idle Stop above the plugin's threshold clears the context with /clear and submits a resume prompt, and a clear or
// compaction hands the file back to the model. Without the file every hook here passes. It reads and writes that one file
// and sends nothing.
import type { EngineInterface, Register } from 'claude-code'

import { FILE, HEADER } from './handoff.mjs'

const OPEN = '<!-- benchkeeper:status -->'
const CLOSE = '<!-- /benchkeeper:status -->'
// A second /clear while the restore hook of the first still runs cuts that hook off and loses its context.
const GAP_MS = 10 * 60 * 1000
const resume = (tokens: number) => `BenchKeeper cleared this coordinator's context at ${tokens} tokens to save tokens. Run the Resume steps of the handoff file in your context now, before anything else, then continue from its Next section.`

// Per Claude Code process: the module stays loaded across /clear.
let running = false
let lastEnd: number | null = null
let noted = false

// The text with its status block holding only this line, the block appended when the text has none.
export function withStatus(text: string, line: string): string {
  const block = `${OPEN}\n${line}\n${CLOSE}`
  const start = text.lastIndexOf(OPEN)
  const end = start < 0 ? -1 : text.indexOf(CLOSE, start)
  if (end < 0) return `${text.trimEnd()}\n\n${block}\n`
  return text.slice(0, start) + block + text.slice(end + CLOSE.length)
}

const handoff = async ($: EngineInterface) => `${await $.session.cwd()}/${FILE}`
const stamp = (ms: number) => new Date(ms).toISOString()

// Rewrites the status line of an existing handoff file; a missing file rejects, so nothing is created.
async function status($: EngineInterface, event: string, tokens: number | undefined) {
  const path = await handoff($)
  const text = await $.fs.read(path)
  const context = tokens === undefined ? 'unread' : `${tokens} tokens`
  await $.fs.write(path, withStatus(String(text), `${stamp(await $.clock.now())} ${event}; context: ${context}; last clear: ${lastEnd === null ? 'none' : stamp(lastEnd)}`))
}

// A row of the transcript the person sees and the model does not read.
const note = ($: EngineInterface, text: string) => $.session.append({ message: { type: 'system', content: [{ type: 'text', text }] } })

async function rotate($: EngineInterface, tokens: number, now: number) {
  try {
    await $.command.run({ command: 'clear' })
    await $.prompt.submit({ text: resume(tokens) })
  } catch (error) {
    await note($, `BenchKeeper could not clear and resume this coordinator: ${error instanceof Error ? error.message : String(error)}`).catch(() => undefined)
  } finally {
    lastEnd = await $.clock.now().catch(() => now)
    running = false
  }
}

export const register: Register = (on, options) => {
  const atTokens = typeof options.rotateAtTokens === 'number' ? options.rotateAtTokens : 200000
  const atPercent = typeof options.rotateAtPercent === 'number' ? options.rotateAtPercent : 0

  on('classic.SessionStart', { source: ['clear', 'compact'] }, async ($, e, next) => {
    const result = await next(e)
    const text = await $.fs.read(await handoff($)).catch(() => null)
    if (text === null) return result
    return { ...result, additionalContext: [...(result.additionalContext ?? []), `${HEADER}\n\n${String(text)}`] }
  }).catch(($, e, next) => next(e))

  on('classic.PreCompact', async ($, e, next) => {
    if (!e.agent_id) {
      const usage = await $.session.usage().catch(() => null)
      await status($, 'compacting', usage?.context.tokens).catch(() => undefined)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    // A background task or a Stop hook's re-prompt means the turn is not idle.
    if (e.agent_id || e.stop_hook_active || e.background_tasks?.length || running) return result
    if (atPercent <= 0 && atTokens <= 0) return result
    const now = await $.clock.now()
    if (lastEnd !== null && now - lastEnd < GAP_MS) return result
    if (!(await $.fs.exists(await handoff($)))) return result
    const { context } = await $.session.usage()
    if (context.tokens === undefined) {
      if (!noted) {
        noted = true
        await note($, 'BenchKeeper cannot read the context size of this session, so it will not clear this coordinator at its threshold.')
        await status($, 'usage unread', undefined).catch(() => undefined)
      }
      return result
    }
    if (atPercent > 0 ? (context.percent ?? 0) < atPercent : context.tokens < atTokens) return result
    running = true
    await status($, `clearing at ${context.tokens} tokens`, context.tokens).catch(() => undefined)
    // A command run from the Stop hook would wait on the turn the hook holds: a timer runs it once the hook has returned.
    const tokens = context.tokens
    $.clock.after(0, () => void rotate($, tokens, now))
    return result
  }).catch(($, e, next) => next(e))
}
