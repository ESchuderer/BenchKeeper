import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SKIP, pins, playwrightDrift } from './version-pins.mjs';

test('install commands get the current version, other version mentions stay', () => {
  const text = 'Run `npx benchkeeper@6.0.0 apply`, or `git clone --branch setup-v6.0 x`. setup-v3.3 took 8 minutes; benchkeeper@6.0.0 in prose.';
  assert.equal(pins(text, '6.1.0'), 'Run `npx benchkeeper@6.1.0 apply`, or `git clone --branch app-v6.1.0 x`. setup-v3.3 took 8 minutes; benchkeeper@6.0.0 in prose.');
});

test('the clone tag is the app tag with three parts; older setup-v pins are rewritten', () => {
  assert.equal(pins('--branch setup-v6.23.0 a, --branch setup-v6.23 b, --branch app-v6.24.0 c', '6.24.1'), '--branch app-v6.24.1 a, --branch app-v6.24.1 b, --branch app-v6.24.1 c');
});

test('files under plugins/ are not rewritten: their pins name the major', () => {
  assert.ok(SKIP.test('plugins/benchkeeper/skills/operating-benchkeeper/SKILL.md'));
  assert.ok(SKIP.test('plugins/benchkeeper/content.json'));
  assert.ok(!SKIP.test('README.md'));
});

test('a package whose @playwright/test differs from the dev container is reported', () => {
  const dockerfile = 'npm i -g @playwright/mcp@0.0.83 && npm i -g playwright@1.64.1';
  const pkg = (v) => ({ devDependencies: { '@playwright/test': v } });
  assert.deepEqual(playwrightDrift(dockerfile, { 'web/package.json': pkg('1.64.1'), 'app/package.json': pkg('1.64.1') }), []);
  assert.deepEqual(playwrightDrift(dockerfile, { 'web/package.json': pkg('1.64.1'), 'app/package.json': pkg('1.65.0') }), ['app/package.json']);
  assert.deepEqual(playwrightDrift('no version', { 'web/package.json': pkg('1.64.1') }), ['web/package.json']);
});
