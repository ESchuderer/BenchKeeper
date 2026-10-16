import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convert } from '../src/index.js';
import { run } from '../src/cli.js';

test('temperatures', () => {
  assert.equal(convert(100, 'c', 'f'), 212);
  assert.equal(convert(0, 'c', 'k'), 273.15);
  assert.throws(() => convert(1, 'c', 'x'), RangeError);
});

test('cli', () => {
  assert.equal(run(['100', 'c', 'f']), '212');
});
