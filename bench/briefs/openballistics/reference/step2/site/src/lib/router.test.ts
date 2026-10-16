import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let router: typeof import('./router');
beforeAll(async () => {
  vi.stubGlobal('location', { hash: '#/c/%E0%A4%A' });
  router = await import('./router');
});
afterAll(() => vi.unstubAllGlobals());

describe('hash routes', () => {
  it('opens preview tools while preserving old deep links', () => {
    expect(router.parse(router.href.preview())).toEqual({ view: 'preview' });
    for (const key of ['9_mm_luger', 'a?b/c#d']) {
      expect(router.parse(router.href.targetScoring(key))).toEqual({ view: 'targetScoring', targetId: key });
    }
  });
  it.each(['#/c/%', '#/b/%E0%A4%A', '#/c/', '#/b/', '#/unknown', '#/guns', '#/rifles'])(
    'falls back safely for %s', (hash) => expect(router.parse(hash)).toEqual({ view: 'list' })
  );
  it('round-trips encoded keys', () => {
    for (const key of ['308_win', 'a b/ß', 'a?b#c']) {
      expect(router.parse(router.href.cartridge(key))).toEqual({ view: 'cartridge', key });
      expect(router.parse(router.href.bullet(key))).toEqual({ view: 'bullet', key });
    }
  });
  it('round-trips compare routes', () => {
    for (const [a, b] of [['308_win', '300_win_mag'], ['a b/ß', 'a?b#c']] as const) {
      expect(router.parse(router.href.compare(a, b))).toEqual({ view: 'compare', a, b });
    }
    expect(router.parse('#/compare/308_win')).toEqual({ view: 'list' });
    expect(router.parse('#/compare/%/308_win')).toEqual({ view: 'list' });
  });
  it('preserves the catalogue and designer routes with query strings', () => {
    expect(router.parse('#/bullets')).toEqual({ view: 'bullets' });
    expect(router.parse('#/designer?img=sample.png')).toEqual({ view: 'designer' });
    expect(router.parse(router.href.targets())).toEqual({ view: 'targets' });
    expect(router.parse(router.href.newTarget())).toEqual({ view: 'newTarget' });
    expect(router.parse(router.href.myData())).toEqual({ view: 'myData' });
    expect(router.parse(router.href.newCartridge())).toEqual({ view: 'newCartridge' });
    expect(router.parse('#/c/308_win?test=1')).toEqual({ view: 'cartridge', key: '308_win' });
  });
});
