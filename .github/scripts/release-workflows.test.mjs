import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const workflow = (name) => readFileSync(new URL(`../workflows/${name}`, import.meta.url), 'utf8');
const npm = workflow('npm.yml');
const release = workflow('release.yml');

// The `run: |` block of the step with this name, without its indentation.
function runBlock(text, name) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  assert.ok(start >= 0, `step ${name}`);
  const run = lines.findIndex((l, i) => i > start && /^ +run: \|$/.test(l));
  const indent = lines[run + 1].match(/^ */)[0].length;
  const body = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() && line.match(/^ */)[0].length < indent) break;
    body.push(line.slice(indent));
  }
  return body.join('\n');
}

function repo() {
  const checkout = runBlock(npm, 'Check out the release commit');
  const dir = mkdtempSync(join(tmpdir(), 'bk-release-'));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const git = (...args) => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8' }).trim();
  const commit = (msg) => {
    writeFileSync(join(dir, 'f'), msg);
    git('add', 'f');
    git('commit', '-q', '-m', msg);
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q', '-b', 'main');
  const R = commit('release');
  git('switch', '-q', '-c', 'side');
  const side = commit('side');
  git('switch', '-q', 'main');
  const N = commit('later merge');
  const run = (sha) => spawnSync('bash', ['-e', '-c', checkout], { cwd: dir, env: { ...env, WANT_SHA: sha }, encoding: 'utf8' });
  return { dir, git, R, N, side, run };
}

test('npm.yml builds the release commit, also after main moved', () => {
  const r = repo();
  try {
    const moved = r.run(r.R);
    assert.equal(moved.status, 0, moved.stdout + moved.stderr);
    assert.equal(r.git('rev-parse', 'HEAD'), r.R);
    // The provenance names the dispatch run, so a moved main is reported.
    assert.match(moved.stdout, /::warning::/);
    r.git('switch', '-q', 'main');
    const head = r.run(r.N);
    assert.equal(head.status, 0, head.stdout + head.stderr);
    assert.equal(r.git('rev-parse', 'HEAD'), r.N);
    assert.doesNotMatch(head.stdout, /::warning::/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test('npm.yml refuses a commit that is not on main, or a ref name', () => {
  const r = repo();
  try {
    for (const sha of [r.side, 'main', r.R.slice(0, 12), '0'.repeat(40), '']) {
      const out = r.run(sha);
      assert.notEqual(out.status, 0, sha);
      assert.match(out.stdout, /::error::/, sha);
      assert.equal(r.git('rev-parse', 'HEAD'), r.N, sha);
    }
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test('npm.yml checks the commit before it installs anything', () => {
  const checkoutAt = npm.indexOf('- name: Check out the release commit');
  assert.ok(checkoutAt > 0);
  assert.ok(checkoutAt < npm.indexOf('npm ci'));
  assert.ok(checkoutAt < npm.indexOf('- name: Version matches the input'));
  assert.match(npm, /^ +WANT_SHA: \$\{\{ inputs\.sha \}\}$/m);
  assert.match(npm, /^ +fetch-depth: 0$/m);
});

test('release.yml dispatches npm.yml with the commit it tags', () => {
  assert.match(release, /^ +SHA: \$\{\{ github\.sha \}\}$/m);
  assert.match(release, /gh workflow run npm\.yml .*-f "sha=\$SHA"/);
});

// GitHub keeps one pending run per concurrency group and cancels the older one: a push after the release merge
// must not cancel the job `release` of the merge commit.
test('release.yml has no workflow-wide concurrency group; the job release has one per commit', () => {
  assert.doesNotMatch(release, /^concurrency:/m);
  const job = release.slice(release.indexOf('\n  release:\n'));
  assert.match(job, /^ {4}concurrency:\n {6}group: \$\{\{ github\.workflow \}\}-release-\$\{\{ github\.sha \}\}\n/m);
  const rp = release.slice(release.indexOf('\n  release-please:\n'), release.indexOf('\n  release:\n'));
  assert.match(rp, /^ {4}concurrency:\n {6}group: \$\{\{ github\.workflow \}\}-release-please\n/m);
});

// A push during the release runs release-please while the release pull request is still pending, which opens nothing.
test('release.yml starts release-please again after it marks the release pull request as tagged', () => {
  const tagged = release.indexOf('- if: ${{ steps.pr.outputs.number != \'\' }}\n        name: Mark the release pull request as tagged');
  const again = release.indexOf('name: Run release-please again');
  assert.ok(tagged > 0 && again > tagged);
  assert.match(release.slice(again), /run: gh workflow run release\.yml --repo "\$REPO" --ref main/);
});
