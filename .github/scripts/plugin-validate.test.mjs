// The plugin check in CI (`claude plugin validate <plugin> --strict`) must fail on a broken manifest and on a broken skill front matter.
// Each case starts from a valid scratch plugin (the control) and breaks one file. Needs the `claude` binary: CI always has it, elsewhere the tests skip.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const MANIFEST = { name: 'demo', version: '1.0.0', description: 'A demo.', author: { name: 'demo' }, license: 'MIT' };
const SKILL = '---\nname: demo\ndescription: "A demo."\n---\n# Demo\n';
const hasClaude = spawnSync('claude', ['--version'], { stdio: 'ignore' }).status === 0;
const skip = !hasClaude && !process.env.CI;

// A temporary HOME keeps the run away from the real Claude Code config.
function validate({ manifest = JSON.stringify(MANIFEST), skill = SKILL }) {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-validate-'));
  try {
    mkdirSync(join(dir, 'plugin/.claude-plugin'), { recursive: true });
    mkdirSync(join(dir, 'plugin/skills/demo'), { recursive: true });
    writeFileSync(join(dir, 'plugin/.claude-plugin/plugin.json'), manifest);
    writeFileSync(join(dir, 'plugin/skills/demo/SKILL.md'), skill);
    return spawnSync('claude', ['plugin', 'validate', join(dir, 'plugin'), '--strict'], { env: { ...process.env, HOME: dir }, encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a valid plugin passes', { skip }, () => {
  assert.equal(validate({}).status, 0);
});

test('an invalid manifest fails', { skip }, () => {
  assert.equal(validate({ manifest: '{"name": "demo",' }).status, 1);
});

test('a broken skill front matter fails', { skip }, () => {
  assert.equal(validate({ skill: '---\nname: demo\ndescription: "A demo\n---\n# Demo\n' }).status, 1);
});

// A warning only: strict mode is what turns it into a failure.
test('a skill without front matter fails', { skip }, () => {
  assert.equal(validate({ skill: '# Demo\n' }).status, 1);
});
