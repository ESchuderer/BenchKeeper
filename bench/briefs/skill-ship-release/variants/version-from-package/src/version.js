import { createRequire } from 'node:module';

export const { version: VERSION } = createRequire(import.meta.url)('../package.json');
