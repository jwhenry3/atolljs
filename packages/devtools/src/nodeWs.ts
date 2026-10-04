/**
 * Minimal RFC6455 *client* for Node — the `ws`-free counterpart to the
 * server in ws.ts. Used only when the global `WebSocket` doesn't exist
 * (Node < 22); imported lazily from client.ts so it never enters browser
 * bundles. Supports ws:// and wss://, text frames, ping/pong, and close.
 */
import { randomBytes } from 'node:crypto';
import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import type { Socket } from 'node:net';
import {
  decodeFrames,
  encodeMaskedControl,
  encodeMaskedTextFrame,
  OPCODES,
} from './ws';

export interface NodeWebSocket {
  readonly open: boolean;
  send(text: string): void;
  close(): void;
  onOpen: (() => void) | null;
  onClose: (() => void) | null;
}

/** Connect a WebSocket to `url` — handshake, then framed text IO. */
export function connectNodeWebSocket(url: string): NodeWebSocket {
  const u = new URL(url);
  const secure = u.protocol === 'wss:';
  const port = Number(u.port || (secure ? 443 : 80));
  const key = randomBytes(16).toString('base64');
  const path = `${u.pathname || '/'}${u.search}`;

  const socket: Socket = secure
    ? tlsConnect({ host: u.hostname, port, servername: u.hostname })
    : netConnect(port, u.hostname);

  let buf: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let fragments: Buffer<ArrayBufferLike>[] = [];
  let upgraded = false;
  let open = false;
  let closed = false;

  const conn: NodeWebSocket = {
    get open() {
      return open;
    },
    send(text) {
      if (open && !closed) socket.write(encodeMaskedTextFrame(text));
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        if (open) socket.write(encodeMaskedControl(OPCODES.close));
        socket.end();
      } catch {
        /* already gone */
      }
      open = false;
      conn.onClose?.();
    },
    onOpen: null,
    onClose: null,
  };

  const die = () => {
    if (!closed) {
      closed = true;
      open = false;
      conn.onClose?.();
    }
  };

  socket.on('connect', () => {
    socket.write(
      `GET ${path} HTTP/1.1\r\n` +
        `Host: ${u.host}\r\n` +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Key: ${key}\r\n` +
        'Sec-WebSocket-Version: 13\r\n' +
        '\r\n',
    );
  });

  socket.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    if (!upgraded) {
      const end = buf.indexOf('\r\n\r\n');
      if (end === -1) return;
      const head = buf.subarray(0, end).toString('latin1');
      buf = buf.subarray(end + 4);
      if (!/^HTTP\/1\.1 101\b/.test(head)) return die();
      upgraded = true;
      open = true;
      conn.onOpen?.();
      if (closed) return; // onOpen may have closed us
    }
    const { frames, rest } = decodeFrames(buf);
    buf = rest;
    for (const { fin, opcode, payload } of frames) {
      if (opcode === OPCODES.close) return conn.close();
      if (opcode === OPCODES.ping) {
        socket.write(encodeMaskedControl(OPCODES.pong, payload));
        continue;
      }
      if (opcode === OPCODES.pong) continue;
      if (opcode === OPCODES.text || opcode === OPCODES.continuation) {
        fragments.push(payload);
        if (fin) fragments = []; // client.ts never reads frames — drain only
      }
    }
  });
  socket.on('error', die);
  socket.on('close', die);
  return conn;
}
