/**
 * Real node:worker_threads fixture serving HTTP inside the worker: sockets
 * accepted on the main thread arrive as HTTP_CONNECTION messages (transferred
 * net.Socket objects) and are fed to this worker's http.Server — the whole
 * request lifecycle runs off the API thread. Imports the real serveHttp
 * from the package source (Node strips its types natively).
 */
import { threadId } from 'node:worker_threads';
import { serveHttp } from '../../packages/node/src/http.ts';

serveHttp((req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ threadId, url: req.url, method: req.method }));
});
