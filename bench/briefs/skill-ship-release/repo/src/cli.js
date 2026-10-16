#!/usr/bin/env node
// unitconv <value> <from> <to> [--precision <digits>] | --version
import { pathToFileURL } from 'node:url';
import { convert } from './index.js';
import { VERSION } from './version.js';

export function run(argv) {
  if (argv[0] === '--version') return VERSION;
  const [value, from, to, flag, digits] = argv;
  const result = convert(Number(value), from, to);
  return flag === '--precision' ? result.toFixed(Number(digits)) : String(result);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) console.log(run(process.argv.slice(2)));
