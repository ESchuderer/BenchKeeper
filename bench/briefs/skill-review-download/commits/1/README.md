# attachments

HTTP service for the attachments of the support desk. The attachments are files in one directory (`ATTACHMENTS_DIR`,
default `./attachments`); the service runs next to other services on the same host, whose files it must not serve.

- `GET /health`: `ok`
- `GET /files/<name>`: the attachment `<name>` as a download (`<name>` URL-encoded)

Start: `npm start` (`PORT`, default 8080). Tests: `npm test` (Node.js 22, no dependencies).
