// Follows the base in src/lib/edition.ts, so the tests run against either edition's build.
export const BASE = process.env.SITE_EDITION === 'next' ? '/BenchKeeper/next/' : '/BenchKeeper/';
