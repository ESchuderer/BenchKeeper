import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';

// Post-build: external links open in a new tab (no client JavaScript), unused client bundles are removed.
const postBuild = {
  name: 'post-build',
  hooks: {
    'astro:build:done': async ({ dir, pages }) => {
      // Astro emits the React client renderer even without islands; drop it when no page references it.
      const assets = new URL('_astro/', dir);
      const htmls = [];
      for (const { pathname } of pages) htmls.push(await readFile(new URL(`${pathname}index.html`, dir), 'utf8'));
      for (const name of await readdir(assets)) {
        if (name.endsWith('.js') && !htmls.some((h) => h.includes(name))) await rm(new URL(name, assets));
      }
      for (const { pathname } of pages) {
        const file = new URL(`${pathname}index.html`, dir);
        const html = await readFile(file, 'utf8');
        await writeFile(file, html.replace(/<a ([^>]*href="https?:\/\/[^"]*"[^>]*)>/g,
          (tag, attrs) => (attrs.includes('target=') ? tag : `<a ${attrs} target="_blank" rel="noopener noreferrer">`)));
      }
    },
  },
};

export default defineConfig({
  site: 'https://eschuderer.github.io',
  base: '/BenchKeeper',
  integrations: [react(), postBuild],
});
