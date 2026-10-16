// Step 1 checks of skill-debug-discount, run by skill-common/run.mjs. Root cause: linesOf() returns the catalog's own
// product objects, so applyDiscount() changes the catalog (later orders in the batch get a discounted base price) and
// two lines with the same product share one quantity. The symptom fix (applyDiscount() without side effects) passes
// S1-batch and fails S1-root. Expected totals come from the workspace's own priceCart() on a fresh catalog, so only
// S1-discount fails when the discount arithmetic itself changes.
import assert from 'node:assert/strict';
import { cpSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Through the public entry points (loadCatalog, priceCart, runBatch), on the baseline's fixtures: the agent's fixtures/
// are replaced by /base's in this check's copy, so the catalog's type is the agent's and the expected data is not.
async function mods(t) {
  rmSync(join(t.ws, 'fixtures'), { recursive: true, force: true });
  cpSync(join(t.base, 'fixtures'), join(t.ws, 'fixtures'), { recursive: true });
  const { loadCatalog } = await t.load('src/catalog.js');
  return {
    ...(await t.load('src/pricing.js')), ...(await t.load('src/batch.js')),
    catalog: () => loadCatalog(join(t.ws, 'fixtures/catalog.json')),
    orders: JSON.parse(readFileSync(join(t.base, 'fixtures/orders.json'), 'utf8')),
  };
}

export default {
  'S1-batch': async (t) => {
    const m = await mods(t);
    assert.deepEqual(m.runBatch(m.orders, m.catalog()).map((r) => r.total), m.orders.map((o) => m.priceCart(o, m.catalog())));
    assert.equal(m.priceCart(m.orders.find((o) => o.id === 1003), m.catalog()), 6910);
    return true;
  },
  'S1-root': async (t) => {
    const m = await mods(t);
    const price = (items, code) => m.priceCart({ id: 9, code, items }, m.catalog());
    assert.equal(price([{ sku: 'TEE', qty: 1 }, { sku: 'TEE', qty: 2 }]), price([{ sku: 'TEE', qty: 3 }]), 'no code');
    assert.equal(price([{ sku: 'CAP', qty: 2 }, { sku: 'CAP', qty: 1 }], 'SAVE10'), price([{ sku: 'CAP', qty: 3 }], 'SAVE10'), 'SAVE10');
    return true;
  },
  'S1-discount': async (t) => {
    const m = await mods(t);
    assert.equal(m.priceCart({ id: 9, code: 'SAVE10', items: [{ sku: 'CAP', qty: 1 }, { sku: 'GIFT', qty: 1 }] }, m.catalog()), 1796 + 2500);
    assert.equal(m.priceCart({ id: 9, code: 'SAVE25', items: [{ sku: 'MUG', qty: 3 }] }, m.catalog()), 3 * 971);
    return true;
  },
  // The workspace's tests fail on the baseline's src/ by a failed assertion (a regression test for the bug), not
  // because a test file does not load there (an import the baseline lacks, a syntax error) or hangs. Whether they pass
  // on the workspace's own src/ is the suite (suite.json).
  'S1-test': async (t) => {
    rmSync(join(t.ws, 'src'), { recursive: true, force: true });
    cpSync(join(t.base, 'src'), join(t.ws, 'src'), { recursive: true });
    const r = t.sh('node --test --test-reporter=tap');
    if (r.timedOut) return { ok: false, detail: 'time limit' };
    const load = /ERR_MODULE_NOT_FOUND|SyntaxError|does not provide an export/.exec(r.out);
    if (load) return { ok: false, detail: `a test file does not load on the baseline: ${load[0]}` };
    const assertion = r.code !== 0 && /ERR_ASSERTION/.test(r.out);
    return { ok: assertion, detail: assertion ? 'an assertion fails on the baseline' : r.code === 0 ? 'passes on the baseline' : 'fails without a failed assertion' };
  },
};
