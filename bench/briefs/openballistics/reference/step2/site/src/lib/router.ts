/**
 * Five views is still not a routing problem. `#/`, `#/c/<key>`, `#/bullets` and `#/b/<key>` are
 * the whole surface, and a hash route works on GitHub Pages without a server rewrite - a
 * path-based router would 404 on a hard refresh of any URL but the root.
 */

import { readable } from 'svelte/store';

export type Route =
  | { view: 'list' }
  | { view: 'cartridge'; key: string }
  | { view: 'compare'; a: string; b: string }
  | { view: 'bullets' }
  | { view: 'bullet'; key: string }
  | { view: 'designer' }
  | { view: 'targets' }
  | { view: 'newTarget' }
  | { view: 'preview' }
  | { view: 'targetScoring'; targetId?: string }
  | { view: 'myData' }
  | { view: 'newCartridge' };

export function parse(hash: string): Route {
  const path = hash.replace(/^#\/?/, '').split('?')[0];
  if (path?.startsWith('c/') || path?.startsWith('b/')) {
    try {
      const key = decodeURIComponent(path.slice(2));
      if (key) return { view: path.startsWith('c/') ? 'cartridge' : 'bullet', key };
    } catch {
      // A malformed escape in a shared URL must not prevent the app from mounting.
    }
    return { view: 'list' };
  }
  const compare = path?.match(/^compare\/([^/]+)\/([^/]+)$/);
  if (compare) {
    try {
      return { view: 'compare', a: decodeURIComponent(compare[1]!), b: decodeURIComponent(compare[2]!) };
    } catch {
      return { view: 'list' };
    }
  }
  if (path === 'bullets') return { view: 'bullets' };
  if (path === 'designer') return { view: 'designer' };
  const params = new URLSearchParams(hash.split('?').slice(1).join('?'));
  if (path === 'preview') return { view: 'preview' };
  if (path === 'targets/score') return { view: 'targetScoring', targetId: params.get('target') || undefined };
  if (path === 'targets/new') return { view: 'newTarget' };
  if (path === 'targets') return { view: 'targets' };
  if (path === 'data') return { view: 'myData' };
  if (path === 'new') return { view: 'newCartridge' };
  return { view: 'list' };
}

export const route = readable<Route>(parse(location.hash), (set) => {
  const update = () => set(parse(location.hash));
  addEventListener('hashchange', update);
  return () => removeEventListener('hashchange', update);
});

export const href = {
  list: () => '#/',
  cartridge: (key: string) => `#/c/${encodeURIComponent(key)}`,
  compare: (a: string, b: string) => `#/compare/${encodeURIComponent(a)}/${encodeURIComponent(b)}`,
  bullets: () => '#/bullets',
  bullet: (key: string) => `#/b/${encodeURIComponent(key)}`,
  designer: () => '#/designer',
  preview: () => '#/preview',
  targetScoring: (id?: string) => '#/targets/score' + (id ? `?target=${encodeURIComponent(id)}` : ''),
  targets: () => '#/targets',
  newTarget: () => '#/targets/new',
  myData: () => '#/data',
  newCartridge: () => '#/new',
  /** The designer with the sample photograph loaded: our own drawing of a bullet, with a ruler. */
  designerSample: () => `#/designer?img=${encodeURIComponent(`${import.meta.env.BASE_URL}designer/sample.png`)}`
};
