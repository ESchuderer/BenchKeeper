import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { readFile, writeFile } from 'node:fs/promises';

// External links open in a new tab; done on the built HTML so no client JavaScript is needed.
const externalLinksNewTab = {
  name: 'external-links-new-tab',
  hooks: {
    'astro:build:done': async ({ dir, pages }) => {
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
  integrations: [react(), externalLinksNewTab],
});
