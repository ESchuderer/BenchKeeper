import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pins } from './version-pins.mjs';

test('install commands get the current version, other version mentions stay', () => {
  const text = 'Run `npx benchkeeper@6.0.0 apply`, or `git clone --branch setup-v6.0 x`. setup-v3.3 took 8 minutes; benchkeeper@6.0.0 in prose.';
  assert.equal(pins(text, '6.1.0'), 'Run `npx benchkeeper@6.1.0 apply`, or `git clone --branch setup-v6.1.0 x`. setup-v3.3 took 8 minutes; benchkeeper@6.0.0 in prose.');
});

test('the clone tag has three parts, and a two-part pin from before the patch releases is rewritten', () => {
  assert.equal(pins('--branch setup-v6.23.0 a, --branch setup-v6.23 b', '6.24.1'), '--branch setup-v6.24.1 a, --branch setup-v6.24.1 b');
});
