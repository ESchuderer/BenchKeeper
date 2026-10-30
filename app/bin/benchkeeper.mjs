#!/usr/bin/env node
import { main } from '../src/cli.mjs';
import { appVersion } from '../src/content.mjs';
import { mask } from '../src/redact.mjs';
import { updateNotice } from '../src/update.mjs';

// Interactive use only, so scripts get no extra request or delay.
if (process.stdout.isTTY) updateNotice(appVersion).then((n) => n && console.error(n)).catch((e) => console.error(e.message));
main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(mask(process.env.BENCHKEEPER_DEBUG === '1' ? e?.stack ?? String(e) : e?.message ?? String(e))); process.exitCode = 2; });
