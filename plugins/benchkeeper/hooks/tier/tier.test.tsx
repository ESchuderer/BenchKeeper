import { expect, mock, test } from 'claude-code/testing'

import { lastTier } from './register'

const BAND = {
  plugin: 'benchkeeper',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const
const ON = { options: { tierBand: true } }
const COMPOSE = { model: 'claude-sonnet-5-5', promptModel: 'claude-sonnet-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as const

// The engine beneath: a session id, a store, an empty system prompt, another mod's band, and a step that answers text.
function engine(on: Parameters<Parameters<typeof test>[1]>[1], store: Record<string, unknown> = {}) {
  mock.store(on, store)
  on('session.id', () => ({ value: 's1' }))
  on('prompt.compose', () => ({ sections: [] }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>other band</Text>
  })
  let answer = ''
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer, toolUses: [], stopReason: 'end_turn', usage: null }
  })
  return { answer: (text: string) => { answer = text } }
}
async function step($: Parameters<Parameters<typeof test>[1]>[0], agentId?: string) {
  const s = $.turn.step({ turnId: 't1', index: 0, model: 'claude-sonnet-5-5', messageCount: 1, ...(agentId ? { agentId } : {}) })
  for await (const _ of s) { /* chunks */ }
  return s.result
}
const sections = async ($: Parameters<Parameters<typeof test>[1]>[0]) => (await $.prompt.compose(COMPOSE)).sections.filter(x => x.id === 'benchkeeper:tier')

test('reads the last tier line and its change type', () => {
  expect(lastTier('Reading.\nTier: quick (docs, typo)\nTier: full (feature)\ndone')).toEqual({ tier: 'full', changeType: 'feature' })
  expect(lastTier('Tier: research')).toEqual({ tier: 'research', changeType: null })
  expect(lastTier('The Tier: quick line is mid-sentence')).toBeNull()
})

test('off by default: no band, no prompt section, no override kept', async ($, on) => {
  const e = engine(on)
  e.answer('Tier: standard (bug, known cause)')
  await step($)
  await $.prompt.submit({ text: '/benchkeeper:tier full', command: { name: 'benchkeeper:tier', args: 'full' } })
  expect(await sections($)).toEqual([])
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^Tier:/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /other band/ })).toBeDefined()
  await ui.unmount()
})

test('on: the band shows the tier of the main loop, above the other mods', ON, async ($, on) => {
  const e = engine(on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Tier: none yet/ })).toBeDefined()
  e.answer('Tier: standard (bug, known cause)')
  await step($)
  e.answer('Tier: full (feature)')
  await step($, 'subagent-1')
  expect(await ui.find({ type: 'Text', text: /Tier: standard \(bug, known cause\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /override: none/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /other band/ })).toBeDefined()
  await ui.unmount()
  const desktop = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await desktop.find({ type: 'Text', text: /Tier: standard/ })).toBeDefined()
  await desktop.unmount()
})

test('on: /benchkeeper:tier sets a session override that every prompt carries, also after compaction and resume', ON, async ($, on) => {
  engine(on)
  await $.prompt.submit({ text: '/benchkeeper:tier full', command: { name: 'benchkeeper:tier', args: 'full' } })
  expect((await sections($))[0]?.text).toMatch(/Tier override for this session .*: full/)
  // A compaction composes the prompt again: the section is still there.
  expect((await sections($)).length).toBe(1)
  // A typo leaves the override; the skill then asks which tier was meant.
  await $.prompt.submit({ text: '/benchkeeper:tier fulll', command: { name: 'benchkeeper:tier', args: 'fulll' } })
  expect((await sections($))[0]?.text).toMatch(/: full\./)
  await $.prompt.submit({ text: '/benchkeeper:tier Auto', command: { name: 'benchkeeper:tier', args: 'Auto' } })
  expect(await sections($)).toEqual([])
})

test('on: a resumed session finds its override in the store', ON, async ($, on) => {
  engine(on, { 'override:s1': 'standard' })
  expect((await sections($))[0]?.text).toMatch(/: standard\./)
})

test('on: the buttons run /benchkeeper:tier as a person types it', ON, async ($, on) => {
  engine(on)
  const sent: string[] = []
  on('command.run', (_, e) => {
    sent.push(`/${e.command} ${e.args}`)
    return { text: '' }
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'full' })
  expect(sent).toEqual(['/benchkeeper:tier full'])
  expect(await ui.find({ type: 'Text', text: /override: full/ })).toBeDefined()
  await ui.press({ key: 'auto' })
  expect(await ui.find({ type: 'Text', text: /override: none/ })).toBeDefined()
  await ui.unmount()
})

test('on: the board button opens the board the app wrote, or says how to get one', ON, async ($, on) => {
  engine(on)
  const ran: string[][] = []
  const toasts: string[] = []
  let written = false
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('fs.exists', (_, e) => ({ value: written && e.path === '/home/u/.config/benchkeeper/board.html' }))
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    return { value: { exitCode: 0, stdout: 'Linux\n', stderr: '' } } as never
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'board' })
  expect(toasts).toEqual(['No sessions board yet: open Sessions in the BenchKeeper app, or run benchkeeper sessions board'])
  expect(ran).toEqual([])
  written = true
  await ui.press({ key: 'board' })
  expect(ran).toEqual([['uname'], ['xdg-open', '/home/u/.config/benchkeeper/board.html']])
  await ui.unmount()
})

test('on: the band names the project, branch, last test run and Ponytail level; no Ponytail file, no Ponytail text', ON, async ($, on) => {
  engine(on)
  let level = 'full\n'
  let outcome: { isError?: true; text: string } = { text: '12 passing' }
  on('session.cwd', () => ({ value: '/work/shop/' }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'feat/cart\n', stderr: '' } }) as never)
  on('fs.read', (_, e) => {
    if (e.path !== '/home/u/.claude/.ponytail-active' || level === '') throw new Error('no such file')
    return { value: level } as never
  })
  on('tool.call', () => ({ result: {}, ...outcome }) as never)
  const test = (command: string) => $.tool.call({ tool: 'Bash', command } as never)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await step($)
  expect(await ui.find({ type: 'Text', text: /^shop \(feat\/cart\)  Ponytail: full$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^tests: not run  lint\/types: not run$/ })).toBeDefined()
  await test('cd app && npm test')
  expect(await ui.find({ type: 'Text', text: /tests: passed/ })).toBeDefined()
  // A command that is no test run, and a failed command that is not a test failure, leave the result.
  outcome = { isError: true, text: 'Exit code 1\nnot ok' }
  await test('ls')
  expect(await ui.find({ type: 'Text', text: /tests: passed/ })).toBeDefined()
  await test('node --test')
  expect(await ui.find({ type: 'Text', text: /tests: failed/ })).toBeDefined()
  outcome = { isError: true, text: 'interrupted' }
  await test('node --test')
  expect(await ui.find({ type: 'Text', text: /tests: failed/ })).toBeDefined()
  // A compound command, a quoted name and a background run do not report the test's own outcome.
  outcome = { text: '12 passing' }
  await test('node --test')
  expect(await ui.find({ type: 'Text', text: /tests: passed/ })).toBeDefined()
  for (const command of ['npm test || true', 'echo "npm test"', 'npm test | tee log', 'npm test; ls']) {
    await test('node --test')
    await test(command)
    expect(await ui.find({ type: 'Text', text: /tests: not run / })).toBeDefined()
  }
  // In a chain that failed, the failure may belong to another part: false && npm test ran no test, npm test && false passed it.
  for (const command of ['false && npm test', 'npm test && false', 'cd app && npm test']) {
    outcome = { text: '12 passing' }
    await test('node --test')
    outcome = { isError: true, text: 'Exit code 1' }
    await test(command)
    expect(await ui.find({ type: 'Text', text: /tests: not run / })).toBeDefined()
  }
  // Redirections, a runner before the command and one sh -c script are read as the command they run.
  for (const command of ['npm test > test.log 2>&1', 'npm test &> test.log', 'npx vitest run', 'pnpm test', 'yarn jest', 'bunx vitest',
    'npm run test:unit', 'python -m pytest', 'uv run pytest', "devcontainer exec --workspace-folder . sh -lc 'cd app && npm test'",
    'sh -c "npm test 2>&1 > log"']) {
    outcome = { isError: true, text: 'Exit code 1' }
    await test('node --test')
    outcome = { text: '12 passing' }
    await test(command)
    expect(await ui.find({ type: 'Text', text: /tests: passed/ })).toBeDefined()
  }
  for (const command of ["sh -lc 'npm test | tail'", "ls; sh -c 'npm test'", 'npm test 2>&1 | tail']) {
    await test('node --test')
    await test(command)
    expect(await ui.find({ type: 'Text', text: /tests: not run / })).toBeDefined()
  }
  outcome = { text: '12 passing' }
  await test('node --test')
  outcome = { text: 'started', backgroundTaskId: 'b1' } as never
  await test('npm test')
  expect(await ui.find({ type: 'Text', text: /tests: not run / })).toBeDefined()
  level = ''
  await step($)
  expect(await ui.find({ type: 'Text', text: /Ponytail/ })).toBeUndefined()
  await ui.unmount()
})

test('on: the project row comes back after /clear, /resume and /branch', ON, async ($, on) => {
  engine(on)
  on('classic.SessionStart', () => ({}))
  on('session.cwd', () => ({ value: '/work/shop' }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'main\n', stderr: '' } }) as never)
  on('fs.read', () => { throw new Error('no such file') })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /shop/ })).toBeUndefined()
  await $.classic.SessionStart({ source: 'resume' })
  expect(await ui.find({ type: 'Text', text: /^shop \(main\)$/ })).toBeDefined()
  await ui.unmount()
})

test('on: doctor asks the agent to run the doctor, ? explains the band and how to turn it off', ON, async ($, on) => {
  engine(on)
  const sent: string[] = []
  const toasts: string[] = []
  on('command.run', (_, e) => {
    sent.push(`/${e.command} ${e.args}`)
    return { text: '' }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'doctor' })
  expect(sent).toEqual(['/benchkeeper:operating-benchkeeper run benchkeeper doctor for this project and list the findings'])
  await ui.press({ key: 'help' })
  expect(toasts[0]).toMatch(/Nothing leaves this machine\. Turn off: set Tier band to false/)
  await ui.unmount()
})

// One stub answers every tool call: Bash with the outcome set, the edit tools with it too.
function tools($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1]) {
  let outcome: { isError?: true; text: string } = { text: 'ok' }
  on('tool.call', () => ({ result: {}, ...outcome }) as never)
  return {
    set: (o: typeof outcome) => { outcome = o },
    bash: (command: string) => $.tool.call({ tool: 'Bash', command } as never),
    edit: (agentId?: string) => $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'a', new_string: 'b', ...(agentId ? { agentId } : {}) } as never),
  }
}

test('on: an edit of the main loop makes the last results stale; a failed or subagent edit does not', ON, async ($, on) => {
  engine(on)
  const t = tools($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await t.edit()
  expect(await ui.find({ type: 'Text', text: /^tests: not run  lint\/types: not run$/ })).toBeDefined()
  await t.bash('npm test')
  await t.edit()
  expect(await ui.find({ type: 'Text', text: /tests: stale \(1 edit since\)  lint\/types: not run/ })).toBeDefined()
  await t.edit('subagent-1')
  t.set({ isError: true, text: 'String not found' })
  await t.edit()
  t.set({ text: 'ok' })
  expect(await ui.find({ type: 'Text', text: /tests: stale \(1 edit since\)/ })).toBeDefined()
  await $.tool.call({ tool: 'Write', file_path: 'b.ts', content: '' } as never)
  expect(await ui.find({ type: 'Text', text: /tests: stale \(2 edits since\)/ })).toBeDefined()
  await t.bash('npm test')
  expect(await ui.find({ type: 'Text', text: /tests: passed/ })).toBeDefined()
  t.set({ isError: true, text: 'Exit code 1' })
  await t.bash('npm test')
  expect(await ui.find({ type: 'Text', text: /tests: failed/ })).toBeDefined()
  await ui.unmount()
})

test('on: a lint or type check is read with the chain rules of a test run; a quoted name is not one', ON, async ($, on) => {
  engine(on)
  const t = tools($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  for (const command of ['ruff check .', 'cd app && npm run lint', 'npx tsc --noEmit', 'CI=1 eslint .', 'go vet ./...', 'cargo clippy', 'npx eslint .', 'npx biome check']) {
    t.set({ isError: true, text: 'Exit code 1' })
    await t.bash('mypy')
    t.set({ text: 'ok' })
    await t.bash(command)
    expect(await ui.find({ type: 'Text', text: /lint\/types: passed/ })).toBeDefined()
  }
  // A quoted name, a name that is no part's start (npm run lint:fix) or a compound command has no result.
  for (const command of ['echo "eslint"', 'npm run lint:fix', 'tsc || true']) {
    await t.bash('tsc')
    await t.bash(command)
    expect(await ui.find({ type: 'Text', text: /lint\/types: not run/ })).toBeDefined()
  }
  t.set({ isError: true, text: 'Exit code 2' })
  await t.bash('pyright')
  expect(await ui.find({ type: 'Text', text: /lint\/types: failed/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /tests: not run/ })).toBeDefined()
  await ui.unmount()
})

test('on: the verdict follows the tier of the last answer or the override, and the checks since the last edit', ON, async ($, on) => {
  const e = engine(on)
  const t = tools($, on)
  on('command.run', () => ({ text: '' }))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const verdict = async () => (await ui.find({ type: 'Text', text: /^tests: / }))?.text.replace(/^.*lint\/types: (?:not run|passed|failed|stale \(\d+ edits? since\))\s*/, '')
  expect(await verdict()).toBe('')
  e.answer('Tier: research')
  await step($)
  expect(await verdict()).toBe('')
  e.answer('Tier: quick (typo)')
  await step($)
  expect(await verdict()).toBe('checks needed: tests or lint/types')
  await t.bash('tsc')
  expect(await verdict()).toBe('ready')
  await t.edit()
  expect(await verdict()).toBe('checks needed: tests or lint/types')
  await t.bash('npm test')
  expect(await verdict()).toBe('ready')
  t.set({ isError: true, text: 'Exit code 1' })
  await t.bash('eslint .')
  expect(await verdict()).toBe('checks needed: lint/types')
  t.set({ text: 'ok' })
  e.answer('Tier: standard (bug, known cause)')
  await step($)
  await t.bash('eslint .')
  await t.edit()
  await t.bash('tsc')
  expect(await verdict()).toBe('checks needed: tests')
  await t.bash('npm test')
  expect(await verdict()).toBe('ready, review is yours')
  // The override wins over the tier line: quick needs only the fast checks.
  await t.edit()
  await t.bash('tsc')
  expect(await verdict()).toBe('checks needed: tests')
  await ui.press({ key: 'quick' })
  expect(await verdict()).toBe('ready')
  await ui.press({ key: 'full' })
  expect(await verdict()).toBe('checks needed: tests')
  t.set({ isError: true, text: 'Exit code 1' })
  await t.bash('npm test')
  await t.bash('tsc')
  expect(await verdict()).toBe('checks needed: tests, lint/types')
  t.set({ text: 'ok' })
  await t.bash('npm test')
  await t.bash('tsc')
  expect(await verdict()).toBe('ready, review is yours')
  await ui.unmount()
})
