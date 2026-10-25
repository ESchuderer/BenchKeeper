// PUBLIC_PREVIEW=1 runs the tests against the develop preview build (see astro.config.mjs).
export const PREVIEW = process.env.PUBLIC_PREVIEW === '1';
export const BASE = PREVIEW ? '/BenchKeeper/develop/' : '/BenchKeeper/';
