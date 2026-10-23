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
