import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from './html.mjs';

test('errors and warnings per file, plain info messages ignored', () => {
  const r = summarize({ version: '1', messages: [
    { type: 'error', url: 'file:/h/index.html', message: 'Bad' },
    { type: 'error', url: 'file:/h/detail.html', message: 'Bad' },
    { type: 'info', subType: 'warning', url: 'file:/h/detail.html', message: 'W' },
    { type: 'info', url: 'file:/h/index.html', message: 'I' },
    { type: 'non-document-error', url: 'file:/h/index.html', message: 'IO' },
  ] });
  assert.deepEqual([r.errors, r.warnings, r.index, r.detail], [3, 1, { errors: 2, warnings: 0 }, { errors: 1, warnings: 1 }]);
  assert.deepEqual(r.rules, { Bad: 2, IO: 1 });
});

test('no index.html gives null counts', () => {
  assert.deepEqual(summarize({ messages: [], missing: 'no index.html' }), { checker: null, errors: null, warnings: null, reason: 'no index.html' });
});
