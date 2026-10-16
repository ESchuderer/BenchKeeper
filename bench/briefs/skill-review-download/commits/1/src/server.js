// The attachments service: createServer({ root }) returns a node:http server (routes: README.md).
import { createReadStream } from 'node:fs';
import { createServer as httpServer } from 'node:http';
import { basename, join } from 'node:path';

export function createServer({ root }) {
  return httpServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && pathname === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
    if (req.method === 'GET' && pathname.startsWith('/files/')) {
      const file = join(root, decodeURIComponent(pathname.slice('/files/'.length)));
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(basename(file))}`,
      });
      createReadStream(file).pipe(res);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  });
}
