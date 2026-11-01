import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import { readFileSync } from 'node:fs';
import facts from './src/data/facts.json';
import { baseUrl, storageNamespace } from './src/lib/edition';

const REPO = 'https://github.com/ESchuderer/BenchKeeper';
// Written by scripts/generate.mjs, which `npm run build` runs first; the build runs in web/.
const data = JSON.parse(readFileSync('src/pages/_generated/data.json', 'utf8')) as { updated?: string; commit?: string };
// The pages of the sitemap, in this order; 404 is left out.
const PAGES = ['', 'overview/', 'app/', 'writes/', 'changelog/', 'benchmark/'];
const SECTIONS = [['sdlc', 'Workflow'], ['parts', 'What gets installed'], ['start', 'Quick start'], ['selected', 'Why this stack'], ['where', 'Where things run']];

const config: Config = {
  title: 'BenchKeeper',
  tagline: facts.tagline,
  favicon: 'logo.svg',
  url: 'https://eschuderer.github.io',
  baseUrl,
  trailingSlash: true,
  staticDirectories: ['public'],
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  storage: { type: 'localStorage', namespace: storageNamespace },
  // .md files are CommonMark (the changelogs and docs are not MDX).
  markdown: { format: 'detect' },
  headTags: [
    { tagName: 'link', attributes: { rel: 'sitemap', href: `${baseUrl}sitemap.xml` } },
    // Before the first paint: pages that run JavaScript lay out for it (the quick start tabs), without a jump at hydration.
    { tagName: 'script', attributes: {}, innerHTML: "document.documentElement.classList.add('js')" },
  ],
  presets: [
    [
      'classic',
      {
        docs: false,
        blog: false,
        // The brand repository's Docusaurus theme CSS plugs in here, before custom.css, once it is published.
        theme: { customCss: ['./src/pages/_generated/tokens.css', './src/css/custom.css'] },
        sitemap: {
          lastmod: null,
          changefreq: null,
          priority: null,
          createSitemapItems: async ({ defaultCreateSitemapItems, ...params }) => {
            const items = await defaultCreateSitemapItems(params);
            return PAGES.map((p) => {
              const item = items.find((i) => new URL(i.url).pathname === `${baseUrl}${p}`);
              if (!item) throw new Error(`the sitemap has no page ${baseUrl}${p}`);
              return item;
            });
          },
        },
      } satisfies Preset.Options,
    ],
  ],
  themeConfig: {
    image: 'og.png',
    metadata: [
      { property: 'og:type', content: 'website' },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { property: 'og:image:alt', content: 'BenchKeeper logo' },
    ],
    colorMode: { defaultMode: 'light', respectPrefersColorScheme: true },
    navbar: {
      title: 'BenchKeeper',
      logo: { alt: '', src: 'logo.svg', width: 28, height: 28, className: 'logo' },
      items: [
        // activeBaseRegex: a link to a section of the home page is never the current page.
        ...SECTIONS.map(([id, label]) => ({ to: `/#${id}`, label, position: 'left' as const, activeBaseRegex: '^$' })),
        { to: '/overview/', label: 'Overview', position: 'left' },
        { to: '/app/', label: 'The app', position: 'left' },
        { type: 'custom-repo', position: 'right' },
      ],
    },
    footer: {
      links: [
        { label: 'What the app writes', to: '/writes/' },
        { label: 'Changelog', to: '/changelog/' },
        { label: 'Benchmark', to: '/benchmark/' },
        { label: 'Security policy', href: `${REPO}/blob/main/SECURITY.md` },
        { label: 'github.com/ESchuderer/BenchKeeper', href: REPO },
      ],
      copyright: `BenchKeeper, MIT License${data.updated && data.commit ? `, updated ${data.updated} (<a href="${REPO}/commit/${data.commit}" target="_blank" rel="noopener noreferrer">${data.commit.slice(0, 7)}</a>)` : ''}`,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
