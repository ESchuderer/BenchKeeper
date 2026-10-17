import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { cp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { OFF_SITE } from './scripts/bench-data.mjs';

// The scorer's screenshots of the runs on the site, at bench/shots/<run>/<round>/<arm>/ next to the run pages.
async function copyShots(dir) {
  const results = new URL('../bench/results/', import.meta.url);
  for (const run of (await readdir(results)).filter((r) => !OFF_SITE.has(r) && existsSync(new URL(`${r}/manifest.txt`, results)))) {
    for (const round of (await readdir(new URL(`${run}/`, results))).filter((d) => /^round-\d+$/.test(d))) {
      for (const arm of await readdir(new URL(`${run}/${round}/`, results))) {
        const src = new URL(`${run}/${round}/${arm}/screenshots/`, results);
        if (existsSync(src)) await cp(src, new URL(`bench/shots/${run}/${round}/${arm}/`, dir), { recursive: true });
      }
    }
  }
}

// Post-build: external links open in a new tab (no client JavaScript), unused client bundles are removed, screenshots copied.
const postBuild = {
  name: 'post-build',
  hooks: {
    'astro:build:done': async ({ dir }) => {
      await copyShots(dir);
      const files = (await readdir(dir, { recursive: true })).map(String);
      const htmlFiles = files.filter((f) => f.endsWith('.html'));
      const htmls = await Promise.all(htmlFiles.map((f) => readFile(new URL(f, dir), 'utf8')));
      // Astro emits the React client renderer even without islands; drop it when no page references it.
      for (const f of files.filter((n) => /^_astro\/client\.[^/]+\.js$/.test(n))) {
        if (!htmls.some((h) => h.includes(f.slice('_astro/'.length)))) await rm(new URL(f, dir));
      }
      await Promise.all(htmlFiles.map((f, k) => writeFile(new URL(f, dir), htmls[k].replace(/<a ([^>]*href="https?:\/\/[^"]*"[^>]*)>/g,
        (tag, attrs) => (attrs.includes('target=') ? tag : `<a ${attrs} target="_blank" rel="noopener noreferrer">`)))));
    },
  },
};

export default defineConfig({
  site: 'https://eschuderer.github.io',
  base: '/BenchKeeper',
  integrations: [react(), postBuild],
});
