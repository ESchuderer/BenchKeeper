// The attachments service: createServer({ root }) returns a node:http server (routes: README.md).
import { createServer as httpServer } from 'node:http';

export function createServer({ root }) {
  return httpServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && pathname === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  });
}
