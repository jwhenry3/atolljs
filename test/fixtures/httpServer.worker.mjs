/**
 * Real node:worker_threads fixture serving HTTP inside the worker: sockets
 * accepted on the main thread arrive as HTTP_CONNECTION messages (transferred
 * net.Socket objects) and are fed to this worker's http.Server — the whole
 * request lifecycle runs off the API thread. Imports the real serveHttp
 * from the package source (Node strips its types natively).
 *
 * Also answers EXECUTE_TASK minimally, so tests can prove the HTTP channel
 * and the pool's task protocol coexist on one worker.
 */
import { parentPort, threadId } from 'node:worker_threads';
import { serveHttp } from '../../packages/node/src/http.ts';

serveHttp((req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ threadId, url: req.url, method: req.method }));
});

parentPort.on('message', (msg) => {
  if (msg?.type === 'EXECUTE_TASK') {
    parentPort.postMessage({ messageId: msg.messageId, success: true, result: threadId });
  }
});
