import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitSource } from '../ui/fixsource.js';

test('the source of a fix splits off as the earlier /\\s*\\((https:\\/\\/[^\\s)]+)\\)/ did', () => {
  const SOURCE = /\s*\((https:\/\/[^\s)]+)\)/;
  const before = (fix) => ({ text: fix.replace(SOURCE, ''), source: fix.match(SOURCE)?.[1] });
  for (const fix of ['Run benchkeeper apply (https://example.com/a)', 'See (https://x.y/z) then  (https://b.c)', 'no source', '(https://a.b)', 'a \t\n (https://a.b) tail', 'a (http://a.b)', 'a (https://a b)', `${' '.repeat(50)}x`, '']) {
    assert.deepEqual(splitSource(fix), before(fix), fix);
  }
});
