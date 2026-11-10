import { expect, mock, test } from 'claude-code/testing'

import { withStatus } from './register'

type Engine = Parameters<Parameters<typeof test>[1]>[1]
const ROOT = '/work/coord'
const PATH = `${ROOT}/.benchkeeper/runs/handoff.md`
const HANDOFF = '# Handoff\nrun r1\nTerminal: term-a\n\n## Next\nwatch #12\n'
const IDLE = { stop_hook_active: false, background_tasks: [] }
// Each test loads the plugin afresh, so its module state (running, lastEnd, noted) starts empty.

type Setup = { file?: string | null; tokens?: number | null; terminal?: string; stop?: { block?: string; preventContinuation?: true }; hold?: Promise<void>; tracked?: boolean; link?: true; git?: number; slow?: Promise<void>; drop?: string }

function engine(on: Engine, { file = HANDOFF, tokens = 250000, terminal = 'term-a', stop = {}, hold, tracked = false, link, git = 0, slow, drop }: Setup = {}) {
  const clock = mock.clock(on, { now: 3_600_000 })
  const session = mock.session(on)
  const files: Record<string, string> = file === null ? {} : { [PATH]: file }
  const ran: string[] = []
  mock.env(on, { ORCA_TERMINAL_HANDLE: terminal })
  on('session.root', () => ({ value: ROOT }))
  on('fs.stat', (_, e) => {
    if (e.path === ROOT) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: ROOT } }
    if (!(e.path in files)) throw new Error('ENOENT')
    return { value: { kind: 'file', size: 0, mtimeMs: 0, isLink: false, realPath: link ? '/home/me/notes.md' : e.path } }
  })
  on('process.run', async () => {
    await slow
    return { value: { exitCode: git, stdout: tracked ? '.benchkeeper/runs/handoff.md\n' : '', stderr: '' } } as never
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
    return drop === undefined ? { text: e.text } : { text: e.text, drop }
  })
  on('classic.Stop', () => stop)
  on('classic.SessionStart', () => ({ additionalContext: ['other'] }))
  on('classic.PreCompact', () => ({}))
  return { clock, session, files, ran }
}

// One idle Stop that clears and then submits a resume prompt naming the context size.
async function clears($: Parameters<Parameters<typeof test>[1]>[0], e: ReturnType<typeof engine>, size: string) {
  await $.classic.Stop(IDLE)
  await e.clock.settle()
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

test('an idle Stop above 200000 tokens clears, then submits the resume prompt, once in 10 minutes', async ($, on) => {
  const e = engine(on)
  await clears($, e, '250000 tokens')
  expect(e.files[PATH]).toMatch(/clearing at 250000 tokens; context: 250000 tokens; last clear: none\n<!-- \/benchkeeper:status -->\n$/)
  await e.clock.advance(9 * 60_000)
  await $.classic.Stop(IDLE)
  await e.clock.settle()
  expect(e.ran.length).toBe(2)
  await e.clock.advance(2 * 60_000)
  await $.classic.Stop(IDLE)
  await e.clock.settle()
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
  await e.clock.settle()
  expect(e.ran).toEqual([])
})

for (const stop of [{ block: 'keep going' }, { preventContinuation: true } as const]) {
  test(`no clear when another Stop hook answers ${JSON.stringify(stop)}`, async ($, on) => {
    const e = engine(on, { stop })
    await $.classic.Stop(IDLE)
    await e.clock.settle()
    expect(e.ran).toEqual([])
  })
}

test('a second Stop while the clear still runs does not clear again', async ($, on) => {
  let release = () => {}
  const e = engine(on, { hold: new Promise<void>((done) => (release = done)) })
  await $.classic.Stop(IDLE)
  await e.clock.advance(0)
  await $.classic.Stop(IDLE)
  expect(e.ran).toEqual(['/clear'])
  release()
  await e.clock.settle()
  expect(e.ran.length).toBe(2)
})

test('a Stop while another Stop still checks does not schedule a second clear', async ($, on) => {
  let release = () => {}
  const e = engine(on, { slow: new Promise<void>((done) => (release = done)) })
  const first = $.classic.Stop(IDLE)
  const second = $.classic.Stop(IDLE)
  release()
  await Promise.all([first, second])
  await e.clock.settle()
  expect(e.ran.filter((step) => step === '/clear')).toEqual(['/clear'])
})

test('a dropped resume prompt is noted in the transcript', async ($, on) => {
  const e = engine(on, { drop: 'queue full' })
  await $.classic.Stop(IDLE)
  await e.clock.settle()
  expect(e.ran[0]).toBe('/clear')
  expect(e.session.appended().map((row) => row.message.type)).toEqual(['system'])
})

test('both options at 0 turn the clear off', { options: { rotateAtTokens: 0, rotateAtPercent: 0 } }, async ($, on) => {
  const e = engine(on)
  await $.classic.Stop(IDLE)
  await e.clock.settle()
  expect(e.ran).toEqual([])
})

const refused: [string, Setup][] = [
  ['names no terminal', { file: HANDOFF.replace('Terminal: term-a\n', '') }],
  ['names another terminal', { terminal: 'term-b' }],
  ['is tracked by git', { tracked: true }],
  ['is reached through a link', { link: true }],
  ['sits where git fails', { git: 128 }],
]
for (const [name, setup] of refused) {
  test(`a file that ${name} is not restored, stamped or cleared for`, async ($, on) => {
    const e = engine(on, setup)
    const file = e.files[PATH]
    expect((await $.classic.SessionStart({ source: 'clear' })).additionalContext).toEqual(['other'])
    await $.classic.PreCompact({ trigger: 'auto', custom_instructions: null })
    await $.classic.Stop(IDLE)
    await e.clock.settle()
    expect(e.ran).toEqual([])
    expect(e.files[PATH]).toBe(file)
  })
}

test('a backticked terminal name is this terminal', async ($, on) => {
  const e = engine(on, { file: HANDOFF.replace('term-a', '`term-a`') })
  await $.classic.Stop(IDLE)
  await e.clock.settle()
  expect(e.ran[0]).toBe('/clear')
})

test('below the threshold: no clear', async ($, on) => {
  const e = engine(on, { tokens: 150000 })
  await $.classic.Stop(IDLE)
  await e.clock.settle()
  expect(e.ran).toEqual([])
})

test('a percent of the window replaces the token threshold', { options: { rotateAtPercent: 30 } }, async ($, on) => {
  const e = engine(on)
  await $.classic.Stop(IDLE)
  await e.clock.settle()
  expect(e.ran).toEqual([])
})

test('a percent threshold the context reaches clears', { options: { rotateAtPercent: 20 } }, async ($, on) => {
  const e = engine(on)
  await clears($, e, '25%')
})

test('unread usage is noted once in the transcript and the status block, and nothing is cleared', async ($, on) => {
  const e = engine(on, { tokens: null })
  await $.classic.Stop(IDLE)
  await $.classic.Stop(IDLE)
  await e.clock.settle()
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
