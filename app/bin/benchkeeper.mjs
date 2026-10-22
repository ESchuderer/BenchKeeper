#!/usr/bin/env node
import { main } from '../src/cli.mjs';
import { appVersion } from '../src/content.mjs';
import { updateNotice } from '../src/update.mjs';

// Interactive use only, so scripts get no extra request or delay.
if (process.stdout.isTTY) updateNotice(appVersion).then((n) => n && console.error(n));
main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e.message); process.exitCode = 1; });
