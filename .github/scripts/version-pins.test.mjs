import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SKIP, minAppPin, nodeDrift, pins, playwrightDrift, pnpmDrift } from './version-pins.mjs';

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
  assert.deepEqual(playwrightDrift(dockerfile, { 'web/package.json': pkg('1.64.1'), 'app/package.json': pkg('1.64.1') }), { image: '1.64.1', drift: [] });
  assert.deepEqual(playwrightDrift(dockerfile, { 'web/package.json': pkg('1.64.1'), 'app/package.json': pkg('1.65.0') }).drift, ['app/package.json']);
  assert.deepEqual(playwrightDrift('npm i -g playwright@1.64.1-beta.0', { 'web/package.json': pkg('1.64.1') }).drift, ['web/package.json']);
  assert.equal(playwrightDrift('# was playwright@1.64.1\nRUN npm i -g playwright@1.65.0', {}).image, '1.65.0');
  assert.equal(playwrightDrift('  # RUN npm i -g playwright@1.64.1\nRUN npm i -g playwright@1.65.0', {}).image, '1.65.0');
  assert.equal(playwrightDrift('no version', { 'web/package.json': pkg('1.64.1') }).image, undefined);
});

test('the dev container pnpm must equal the pnpm .github/pnpm pins for CI', () => {
  const dockerfile = '# RUN npm i -g pnpm@12.0.0 was here\nRUN npm i -g --ignore-scripts --prefix /usr/local pnpm@12.16.1 && npm cache clean --force';
  assert.deepEqual(pnpmDrift(dockerfile, '12.16.1'), { image: '12.16.1', drift: false });
  assert.deepEqual(pnpmDrift(dockerfile, '12.17.0'), { image: '12.16.1', drift: true });
  assert.deepEqual(pnpmDrift('no pnpm', '12.16.1'), { image: undefined, drift: true });
  // Docker drops comment lines, then joins continued lines: the version may sit on a later line of the same RUN.
  assert.equal(pnpmDrift('RUN npm i -g --ignore-scripts \\\n  # pnpm@11.0.0 was here\n  pnpm@12.16.1 && npm cache clean --force', '12.16.1').image, '12.16.1');
  assert.equal(pnpmDrift('RUN npm i -g --ignore-scripts \\\r\n  # pnpm@11.0.0 was here\r\n  pnpm@12.16.1 && npm cache clean --force', '12.16.1').image, '12.16.1');
});

test('the dev container Node must equal NODE_VERSION of cedarloom.yml', () => {
  const dockerfile = '# node:26.12.0-bookworm-slim was here\nFROM docker.io/library/node:26.13.0-bookworm-slim@sha256:bc0a AS base\nRUN true';
  const workflow = 'env:\n  # Bumped by hand\n  NODE_VERSION: 26.13.0\n  TYPOS_VERSION: 1.51.1\n';
  assert.deepEqual(nodeDrift(dockerfile, workflow), { image: '26.13.0', ci: '26.13.0', drift: false });
  assert.deepEqual(nodeDrift(dockerfile, workflow.replace('26.13.0', '26.14.0')), { image: '26.13.0', ci: '26.14.0', drift: true });
  // A FROM line without the tag's suffix, or none at all, is drift too: the check must not pass silently.
  assert.equal(nodeDrift('FROM docker.io/library/node:26.13.0@sha256:bc0a', workflow).drift, true);
  assert.equal(nodeDrift('FROM docker.io/library/node:26.13.0-bookworm-slim', 'env: {}').drift, true);
  // Quotes and a trailing comment around NODE_VERSION do not count.
  for (const line of ['NODE_VERSION: "26.13.0"', "NODE_VERSION: '26.13.0'  # bumped by hand", 'NODE_VERSION: 26.13.0 # bumped by hand']) {
    assert.equal(nodeDrift(dockerfile, `env:\n  ${line}\n`).ci, '26.13.0', line);
  }
});

test('minApp follows the release app version; other versions in content.json stay', () => {
  const text = '{\n  "schemaVersion": 1,\n  "contentVersion": "6.25.0",\n  "minApp": "6.25.0"\n}\n';
  assert.equal(minAppPin(text, '6.26.0'), '{\n  "schemaVersion": 1,\n  "contentVersion": "6.25.0",\n  "minApp": "6.26.0"\n}\n');
  assert.equal(minAppPin('{"minApp":"6.25.0"}', '7.0.0'), '{"minApp":"7.0.0"}');
  assert.equal(minAppPin('{"contentVersion": "6.25.0"}', '7.0.0'), '{"contentVersion": "6.25.0"}');
});
