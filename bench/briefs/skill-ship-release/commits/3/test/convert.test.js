import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convert } from '../src/index.js';
import { run } from '../src/cli.js';

test('temperatures', () => {
  assert.equal(convert(100, 'c', 'f'), 212);
  assert.equal(convert(0, 'c', 'k'), 273.15);
  assert.throws(() => convert(1, 'c', 'x'), RangeError);
});

test('lengths', () => {
  assert.equal(convert(1, 'm', 'in').toFixed(2), '39.37');
  assert.throws(() => convert(1, 'm', 'c'), RangeError);
});

test('cli', () => {
  assert.equal(run(['100', 'c', 'f']), '212');
  assert.equal(run(['1', 'in', 'm', '--digits', '3']), '0.025');
  assert.throws(() => run(['abc', 'c', 'f']), RangeError);
});
