// Follows the base in astro.config.mjs, so the tests run against either edition's build.
export const BASE = process.env.SITE_EDITION === 'next' ? '/BenchKeeper/next/' : '/BenchKeeper/';
