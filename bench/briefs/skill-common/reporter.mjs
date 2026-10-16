// node --test reporter: one JSON line per test (not per suite) with its file, nesting, name and result.
export default async function* reporter(source) {
  for await (const e of source) {
    if ((e.type === 'test:pass' || e.type === 'test:fail') && e.data.details?.type !== 'suite') {
      yield `${JSON.stringify({ file: e.data.file ?? null, nesting: e.data.nesting, name: e.data.name, pass: e.type === 'test:pass' && !e.data.skip && !e.data.todo })}\n`;
    }
  }
}
