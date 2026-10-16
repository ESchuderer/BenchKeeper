// Step 1 checks of skill-plan-ttl, run by skill-common/run.mjs, each on its own copy of the workspace. Clocks are injected
// (docs/ARCHITECTURE.md): an implementation that reads Date.now() fails S1-ttl, S1-reads and S1-persist. Each check reads
// one path, so each mutant in validate.sh fails exactly one: get (S1-ttl), keys and size (S1-reads), has after reopen
// (S1-persist).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const T0 = 1_000_000_000;
const file = () => join(mkdtempSync('/tmp/kv-'), 'store.json');
const store = async (t, f = file(), clock = { t: T0 }) => ({ s: (await t.load('src/store.js')).openStore(f, { now: () => clock.t }), f, clock });

export default {
  'S1-ttl': async (t) => {
    const { s, clock } = await store(t);
    s.set('a', 1, { ttl: 1000 });
    s.set('b', 2);
    clock.t = T0 + 500;
    assert.equal(s.get('a'), 1, 'before expiry');
    clock.t = T0 + 1500;
    assert.equal(s.get('a'), undefined, 'after expiry');
    clock.t = T0 + 1e12;
    assert.equal(s.get('b'), 2, 'no ttl');
    return true;
  },
  'S1-reads': async (t) => {
    const { s, clock } = await store(t);
    s.set('a', 1, { ttl: 1000 });
    s.set('b', 2);
    clock.t = T0 + 500;
    assert.deepEqual([s.keys(), s.size], [['a', 'b'], 2], 'before expiry');
    clock.t = T0 + 1500;
    assert.deepEqual([s.keys(), s.size], [['b'], 1], 'after expiry');
    return true;
  },
  'S1-persist': async (t) => {
    const { s, f } = await store(t);
    s.set('a', 1, { ttl: 1000 });
    s.save();
    assert.equal((await store(t, f, { t: T0 + 500 })).s.has('a'), true, 'reopened before expiry');
    assert.equal((await store(t, f, { t: T0 + 1500 })).s.has('a'), false, 'reopened after expiry');
    return true;
  },
  'S1-format': async (t) => {
    const { s, f } = await store(t);
    s.set('a', 'x', { ttl: 1e9 });
    s.set('b', 'y');
    s.save();
    const csv = (await t.load('tools/export-csv.js')).toCsv(readFileSync(f, 'utf8'));
    const at = new Date(T0).toISOString();
    assert.equal(csv, `key,value,updatedAt\na,"""x""",${at}\nb,"""y""",${at}\n`);
    return true;
  },
  'S1-old-data': async (t) => {
    const f = file();
    writeFileSync(f, JSON.stringify({ version: 1, entries: { a: { value: [1], updatedAt: 5 }, b: { value: null, updatedAt: 6 } } }));
    const { s } = await store(t, f);
    assert.deepEqual([s.get('a'), s.has('b'), s.keys()], [[1], true, ['a', 'b']]);
    return true;
  },
  'S1-no-deps': async (t) => {
    const p = JSON.parse(t.read('package.json'));
    const deps = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].flatMap((k) => Object.keys(p[k] || {}));
    return { ok: deps.length === 0, detail: deps.join(',') };
  },
};
