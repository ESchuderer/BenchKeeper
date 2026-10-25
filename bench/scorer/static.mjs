// Static file server for briefs scored with "serve": "static" (brief.json). Usage: node static.mjs <dir>; port from PORT.
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve(process.argv[2]);
const realRoot = await realpath(root);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
createServer(async (req, res) => {
  try {
    let p = normalize(decodeURIComponent(new URL(req.url, 'https://localhost').pathname));
    if (p.endsWith('/')) p += 'index.html';
    const file = join(root, p);
    if (!file.startsWith(root + sep)) throw new Error('outside the root');
    const real = await realpath(file);
    if (!real.startsWith(realRoot + sep)) throw new Error('outside the root');
    const body = await readFile(real);
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(Number(process.env.PORT) || 3000);
// PID 1 in its container: exit on stop instead of waiting for SIGKILL.
process.on('SIGTERM', () => process.exit(0));
