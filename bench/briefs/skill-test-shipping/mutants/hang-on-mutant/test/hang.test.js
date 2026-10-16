import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const hash = createHash('sha256').update(readFileSync(new URL('../src/shipping.js', import.meta.url))).digest('hex');

test('waits forever when src/shipping.js is not the original', async () => {
  if (hash !== '0e1bea44fc8d09137fcd39c6217a9392f1c334ae2b6214dc9790f0e4b93b163b') await new Promise(() => setInterval(() => {}, 1000));
});
