import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse, sep } from 'node:path';
import { test } from 'node:test';
import { unfit, unscannable } from '../src/roots.mjs';

const base = mkdtempSync(join(tmpdir(), 'bk-roots-'));
const home = join(base, 'home');
const ctx = { home, config: join(home, '.config', 'benchkeeper') };
mkdirSync(ctx.config, { recursive: true });
const root = parse(base).root;

test('unfit: drive root, home and its parents, the config folder and what holds or sits in it', () => {
  assert.equal(unfit(ctx, root), 'the root of a drive');
  assert.equal(unfit(ctx, home), 'the home folder or a parent of it');
  assert.equal(unfit(ctx, base), 'the home folder or a parent of it');
  assert.equal(unfit(ctx, ctx.config), 'the BenchKeeper config folder or a folder holding it');
  assert.equal(unfit(ctx, join(ctx.config, 'backups')), 'the BenchKeeper config folder or a folder holding it');
  assert.equal(unfit(ctx, join(home, '.config')), 'the BenchKeeper config folder or a folder holding it');
  assert.equal(unfit(ctx, join(home, 'code', 'app')), null);
  // A sibling whose name starts with the home folder's name is not inside it.
  assert.equal(unfit(ctx, `${home}x`), null);
  assert.equal(unfit(ctx, join(home, '.configx')), null);
});

test('unfit and unscannable: a config folder at the drive root holds every path', () => {
  assert.equal(unfit({ ...ctx, config: root }, join(home, 'code')), 'the BenchKeeper config folder or a folder holding it');
  assert.equal(unscannable({ ...ctx, config: root }, join(home, 'code')), 'the BenchKeeper config folder or a folder inside it');
  assert.equal(unfit({ ...ctx, home: home + sep }, join(home, 'code')), null);
});

test('unscannable: drive root and the config folder and below, not home or its parents', () => {
  assert.equal(unscannable(ctx, root), 'the root of a drive');
  assert.equal(unscannable(ctx, ctx.config), 'the BenchKeeper config folder or a folder inside it');
  assert.equal(unscannable(ctx, join(ctx.config, 'backups')), 'the BenchKeeper config folder or a folder inside it');
  assert.equal(unscannable(ctx, home), null);
  assert.equal(unscannable(ctx, base), null);
  assert.equal(unscannable(ctx, join(home, '.config')), null);
  assert.equal(unscannable(ctx, `${ctx.config}x`), null);
});
