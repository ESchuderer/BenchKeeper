import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { withStatus } from './register'

const ROOT = '/work/coord'
const PATH = `${ROOT}/.benchkeeper/runs/handoff.md`
const HANDOFF = '# Handoff\nrun r1\nTerminal: term-a\n\n## Next\nwatch #12\n'
const IDLE = { stop_hook_active: false, background_tasks: [] }
// Each test loads the plugin afresh, so its module state (running, lastEnd, noted) starts empty.

type Setup = { file?: string | null; tokens?: number | null; terminal?: string; stop?: { block?: string; preventContinuation?: true }; hold?: Promise<void>; tracked?: boolean; link?: true; git?: number; slow?: Promise<void>; drop?: string; surfaces?: string[]; changed?: { log: string; status: string } }

function engine(on: On, { file = HANDOFF, tokens = 250000, terminal = 'term-a', stop = {}, hold, tracked = false, link, git = 0, slow, drop, surfaces = ['terminal'], changed = { log: '', status: '' } }: Setup = {}) {
  const clock = mock.clock(on, { now: 3_600_000 })
  const session = mock.session(on)
  const files: Record<string, string> = file === null ? {} : { [PATH]: file }
  const ran: string[] = []
  mock.env(on, { ORCA_TERMINAL_HANDLE: terminal })
  on('session.root', () => ({ value: ROOT }))
  on('session.surfaces', () => ({ value: surfaces }) as never)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('fs.stat', (_, e) => {
    if (e.path === ROOT) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: ROOT } }
    if (e.path === `${ROOT}/src/a.ts`) return { value: { kind: 'file', size: 0, mtimeMs: 2000, isLink: false } }
    if (!(e.path in files)) throw new Error('ENOENT')
    return { value: { kind: 'file', size: 0, mtimeMs: 1000, isLink: false, realPath: link ? '/home/me/notes.md' : e.path } }
  })
  on('process.run', async (_, e) => {
    await slow
    const stdout = e.argv.includes('log') ? changed.log : e.argv.includes('status') ? changed.status : tracked ? '.benchkeeper/runs/handoff.md\n' : ''
    return { value: { exitCode: git, stdout, stderr: '' } } as never
  })
  on('fs.read', (_, e) => {
    if (!(e.path in files)) throw new Error('ENOENT')
    return { value: files[e.path] ?? '' }
  })
  on('fs.write', (_, e) => {
    files[e.path] = e.text
    return { value: undefined }
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: tokens === null ? { window: 1000000 } : { tokens, window: 1000000, percent: Math.round(tokens / 10000) }, rateLimits: [] } }))
  on('command.run', async (_, e) => {
    ran.push(`/${e.command}`)
    await hold
    return { text: '' }
  })
  on('prompt.submit', (_, e) => {
    ran.push(e.text)
    return drop === undefined ? { text: e.text } : { drop }
  })
  on('classic.Stop', () => stop)
  on('classic.SessionStart', () => ({ additionalContext: ['other'] }))
  on('classic.PreCompact', () => ({}))
  return { clock, session, files, ran }
}

// One idle Stop that clears and then submits a resume prompt naming the context size.
async function clears($: Engine, e: ReturnType<typeof engine>, size: string) {
  await $.classic.Stop(IDLE)
  await e.clock.advance(1000)
  expect(e.ran.length).toBe(2)
  expect(e.ran[0]).toBe('/clear')
  expect(e.ran[1]).toContain(size)
}

test('withStatus replaces the status block or appends one', () => {
  const block = (line: string) => `<!-- benchkeeper:status -->\n${line}\n<!-- /benchkeeper:status -->`
  expect(withStatus('# Handoff\n\n## Next\nx\n', 'one')).toBe(`# Handoff\n\n## Next\nx\n\n${block('one')}\n`)
  expect(withStatus(`# Handoff\n\n${block('one')}\n`, 'two')).toBe(`# Handoff\n\n${block('two')}\n`)
})

test('a clear or compaction hands the file back after the other hooks, and nothing without it', async ($, on) => {
  const e = engine(on)
  for (const source of ['clear', 'compact'] as const) {
    const context = (await $.classic.SessionStart({ source })).additionalContext ?? []
    expect(context[0]).toBe('other')
    expect(context[1]?.endsWith(`\n\n${HANDOFF}`)).toBe(true)
  }
  delete e.files[PATH]
  expect((await $.classic.SessionStart({ source: 'clear' })).additionalContext).toEqual(['other'])
})

test('the restored file is followed by the commits and the files changed since it was written', async ($, on) => {
  engine(on, { changed: { log: 'abc1234 2026-01-01T00:00:00+00:00 add a\n', status: ' M src/a.ts\0' } })
  const restored = (await $.classic.SessionStart({ source: 'clear' })).additionalContext?.[1] ?? ''
  expect(restored).toContain('\nabc1234 2026-01-01T00:00:00+00:00 add a\n')
  expect(restored).toContain('\nsrc/a.ts')
})

test('an idle Stop above 200000 tokens clears, then submits the resume prompt, once in 10 minutes', async ($, on) => {
  const e = engine(on)
  await clears($, e, '250000 tokens')
  expect(e.files[PATH]).toMatch(/clearing at 250000 tokens; context: 250000 tokens; last clear: none\n<!-- \/benchkeeper:status -->\n$/)
  await e.clock.advance(9 * 60_000)
  await $.classic.Stop(IDLE)
  await e.clock.advance(1000)
  expect(e.ran.length).toBe(2)
  await e.clock.advance(2 * 60_000)
  await $.classic.Stop(IDLE)
  await e.clock.advance(1000)
  expect(e.ran.length).toBe(4)
  expect(e.ran[2]).toBe('/clear')
})

test('no clear while not idle, with no task list, in a subagent or without the file', async ($, on) => {
  const e = engine(on)
  await $.classic.Stop({ ...IDLE, background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'orca orchestration check --wait' }] })
  await $.classic.Stop({ stop_hook_active: false } as never)
  await $.classic.Stop({ ...IDLE, stop_hook_active: true })
  await $.classic.Stop({ ...IDLE, agent_id: 'a1' })
  delete e.files[PATH]
  await $.classic.Stop(IDLE)
  await e.clock.advance(1000)
  expect(e.ran).toEqual([])
})

for (const stop of [{ block: 'keep going' }, { preventContinuation: true } as const]) {
  test(`no clear when another Stop hook answers ${JSON.stringify(stop)}`, async ($, on) => {
    const e = engine(on, { stop })
    await $.classic.Stop(IDLE)
    await e.clock.advance(1000)
    expect(e.ran).toEqual([])
  })
}

test('a Stop while the clear still runs does not clear again, also past the 10-minute gap', async ($, on) => {
  let release = () => {}
  const e = engine(on, { hold: new Promise<void>((done) => (release = done)) })
  await $.classic.Stop(IDLE)
  await e.clock.advance(1000)
  await e.clock.advance(11 * 60_000)
  await $.classic.Stop(IDLE)
  await e.clock.advance(1000)
  expect(e.ran).toEqual(['/clear'])
  release()
  await e.clock.advance(1000)
  expect(e.ran.length).toBe(2)
})

test('a turn that starts before the clear makes it give up, and the next idle Stop clears', async ($, on) => {
  const e = engine(on)
  await $.classic.Stop(IDLE)
  await $.turn.start({ turnId: 't2', text: 'You have 1 orchestration message.' })
  await e.clock.advance(1000)
  expect(e.ran).toEqual([])
  await clears($, e, '250000 tokens')
})

test('a Stop while another Stop still checks does not schedule a second clear', async ($, on) => {
  let release = () => {}
  const e = engine(on, { slow: new Promise<void>((done) => (release = done)) })
  const first = $.classic.Stop(IDLE)
  const second = $.classic.Stop(IDLE)
  release()
  await Promise.all([first, second])
  await e.clock.advance(1000)
  expect(e.ran.filter((step) => step === '/clear')).toEqual(['/clear'])
})

test('a dropped resume prompt is noted in the transcript', async ($, on) => {
  const e = engine(on, { drop: 'queue full' })
  await $.classic.Stop(IDLE)
  await e.clock.advance(1000)
  expect(e.ran[0]).toBe('/clear')
  expect(e.session.appended().map((row) => row.message.type)).toEqual(['system'])
})

const unreached: [string, Record<string, number>, Setup][] = [
  ['below the threshold', {}, { tokens: 150000 }],
  ['when a percent of the window replaces the token threshold', { rotateAtPercent: 30 }, {}],
  ['with both options at 0', { rotateAtTokens: 0, rotateAtPercent: 0 }, {}],
]
for (const [name, options, setup] of unreached) {
  test(`no clear ${name}`, { options }, async ($, on) => {
    const e = engine(on, setup)
    await $.classic.Stop(IDLE)
    await e.clock.advance(1000)
    expect(e.ran).toEqual([])
  })
}

const refused: [string, Setup][] = [
  ['names no terminal', { file: HANDOFF.replace('Terminal: term-a\n', '') }],
  ['names another terminal', { terminal: 'term-b' }],
  ['is tracked by git', { tracked: true }],
  ['is reached through a link', { link: true }],
  ['sits where git fails', { git: 128 }],
  ['is read by a session that draws on no surface, a -p child', { surfaces: [] }],
]
for (const [name, setup] of refused) {
  test(`a file that ${name} is not restored, stamped or cleared for`, async ($, on) => {
    const e = engine(on, setup)
    const file = e.files[PATH]
    expect((await $.classic.SessionStart({ source: 'clear' })).additionalContext).toEqual(['other'])
    await $.classic.PreCompact({ trigger: 'auto', custom_instructions: null })
    await $.classic.Stop(IDLE)
    await e.clock.advance(1000)
    expect(e.ran).toEqual([])
    expect(e.files[PATH]).toBe(file)
  })
}

test('a backticked terminal name is this terminal', async ($, on) => {
  const e = engine(on, { file: HANDOFF.replace('term-a', '`term-a`') })
  await $.classic.Stop(IDLE)
  await e.clock.advance(1000)
  expect(e.ran[0]).toBe('/clear')
})

test('a percent threshold the context reaches clears', { options: { rotateAtPercent: 20 } }, async ($, on) => {
  const e = engine(on)
  await clears($, e, '25%')
})

test('unread usage is noted once in the transcript and the status block, and nothing is cleared', async ($, on) => {
  const e = engine(on, { tokens: null })
  await $.classic.Stop(IDLE)
  await $.classic.Stop(IDLE)
  await e.clock.advance(1000)
  expect(e.ran).toEqual([])
  expect(e.session.appended().map((row) => row.message.type)).toEqual(['system'])
  expect(e.files[PATH]).toMatch(/usage unread; context: unread;/)
})

test('compaction writes its status line and only into an existing file', async ($, on) => {
  const e = engine(on, { tokens: 180000 })
  await $.classic.PreCompact({ trigger: 'auto', custom_instructions: null })
  expect(e.files[PATH]).toMatch(/compacting; context: 180000 tokens;/)
  delete e.files[PATH]
  await $.classic.PreCompact({ trigger: 'auto', custom_instructions: null })
  expect(e.files).toEqual({})
})
