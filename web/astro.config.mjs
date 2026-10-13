import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  site: 'https://eschuderer.github.io',
  base: '/BenchKeeper',
  integrations: [react()],
});
