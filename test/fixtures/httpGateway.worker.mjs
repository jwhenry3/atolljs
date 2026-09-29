/**
 * Real node:worker_threads fixture for the gateway topology: the worker's
 * http.Server listens on an internal 127.0.0.1 port and announces it via an
 * HTTP_PORT message — no socket transfer involved, works on any Node.
 * The 'upgrade' handler answers WebSocket-style handshakes and echoes,
 * so tests can verify the gateway's socket tunneling end-to-end.
 */
import { threadId } from 'node:worker_threads';
import { serveHttp } from '../../packages/node/src/http.ts';

const server = serveHttp(
  (req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ threadId, url: req.url, method: req.method }));
  },
  { listen: 0 },
);

server.on('upgrade', (req, socket) => {
  // Minimal handshake — not a real WebSocket server, just enough to prove the
  // tunnel: the response carries this worker's threadId and the REWRITTEN
  // url, then the socket echoes whatever arrives (bidirectional splice check).
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: echo\r\n' +
      'Connection: Upgrade\r\n' +
      `X-Worker: ${threadId}\r\n` +
      `X-Url: ${req.url}\r\n` +
      '\r\n',
  );
  socket.pipe(socket);
});
