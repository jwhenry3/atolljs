/**
 * Real node:worker_threads fixture for the gateway topology: the worker's
 * http.Server listens on an internal 127.0.0.1 port and announces it via an
 * HTTP_PORT message — no socket transfer involved, works on any Node.
 */
import { threadId } from 'node:worker_threads';
import { serveHttp } from '../../packages/node/src/http.ts';

serveHttp(
  (req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ threadId, url: req.url, method: req.method }));
  },
  { listen: 0 },
);
