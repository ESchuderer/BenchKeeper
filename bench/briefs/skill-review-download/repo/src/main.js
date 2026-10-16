import { resolve } from 'node:path';
import { createServer } from './server.js';

const port = Number(process.env.PORT ?? 8080);
createServer({ root: resolve(process.env.ATTACHMENTS_DIR ?? 'attachments') }).listen(port, () => console.log(`listening on ${port}`));
