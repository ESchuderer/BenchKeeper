// The attachments service: createServer({ root }) returns a node:http server (routes: README.md).
import { createReadStream, statSync } from 'node:fs';
import { createServer as httpServer } from 'node:http';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';

export function createServer({ root }) {
  const text = (res, status, body) => res.writeHead(status, { 'content-type': 'text/plain' }).end(body);
  return httpServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && pathname === '/health') {
      text(res, 200, 'ok');
      return;
    }
    if (req.method === 'GET' && pathname.startsWith('/files/')) {
      let name;
      try {
        name = decodeURIComponent(pathname.slice('/files/'.length));
      } catch {
        text(res, 400, 'bad request');
        return;
      }
      // Only regular files inside root: no `..`, no absolute names, no sibling directory that shares root's prefix.
      const file = resolve(root, name);
      const rel = relative(resolve(root), file);
      if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        text(res, 404, 'not found');
        return;
      }
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(basename(file))}`,
      });
      createReadStream(file).pipe(res);
      return;
    }
    text(res, 404, 'not found');
  });
}
