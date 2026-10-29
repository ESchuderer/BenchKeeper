import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';

// Post-build: external links open in a new tab (no client JavaScript), unused client bundles are removed.
const postBuild = {
  name: 'post-build',
  hooks: {
    'astro:build:done': async ({ dir }) => {
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
  // SITE_EDITION=next builds main for /next/ (pages.yml); the root shows the latest release.
  base: process.env.SITE_EDITION === 'next' ? '/BenchKeeper/next' : '/BenchKeeper',
  integrations: [react(), postBuild],
});
