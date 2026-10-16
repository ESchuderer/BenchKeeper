import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cartridgeNames, measurePrint } from './print.mjs';

// A start page linking to detail.html: heading, drawing of the given CSS, extra block of the given height.
function app({ svgCss, filler = 0, pageCss = '' }) {
  const dir = mkdtempSync(join(tmpdir(), 'print-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>x</title><h1>Cartridges</h1><a href="detail.html">A</a>');
  writeFileSync(join(dir, 'detail.html'), `<!doctype html><title>A</title><style>${pageCss} body{margin:0} svg{${svgCss}} @media print{button{display:none}}</style>
<h1>A</h1><button>Print</button><svg role="img" aria-label="A drawing" viewBox="0 0 100 30"><rect width="100" height="30"/></svg><div style="height:${filler}px"></div>`);
  return dir;
}

test('print: full-width one page passes, narrow or two pages fail', async () => {
  const [wide, narrow, long, margins] = await Promise.all([
    measurePrint(app({ svgCss: 'width:100%;height:auto' }), ['A']),
    measurePrint(app({ svgCss: 'width:50%;height:auto' }), ['A']),
    measurePrint(app({ svgCss: 'width:100%;height:auto', filler: 2500 }), ['A']),
    measurePrint(app({ svgCss: 'width:100%;height:auto', pageCss: '@page{margin:20mm}' }), ['A']),
  ]);
  assert.deepEqual([wide.pass, wide.cartridges[0].pages], [1, 1]);
  assert.ok(wide.cartridges[0].width_share >= 0.95);
  assert.equal(narrow.pass, 0);
  assert.ok(narrow.cartridges[0].width_share < 0.6);
  assert.deepEqual([long.pass, long.cartridges[0].pages], [0, 3]);
  assert.equal(margins.pass, 1);
  assert.ok(Math.abs(margins.cartridges[0].width_share - 1) < 0.02, `share ${margins.cartridges[0].width_share}`);
});

test('cartridgeNames reads the record lines of the brief', () => {
  assert.equal(cartridgeNames(new URL('../briefs/cartridges/brief.md', import.meta.url).pathname).length, 25);
});
