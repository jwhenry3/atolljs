/**
 * Minimal RFC6455 server — no `ws` dependency. Both ends are ours (the
 * instrumented app's WebSocket client and the dashboard page), so this only
 * needs: the upgrade handshake, masked text frames in, unmasked text frames
 * out, ping/pong, and close. Continuation frames are accumulated but
 * never produced by us.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OPCODES = { continuation: 0, text: 1, close: 8, ping: 9, pong: 10 } as const;

export interface WsConnection {
  /** Queue a text frame — safe before/without concern for socket state. */
  send(text: string): void;
  close(): void;
  onMessage: ((text: string) => void) | null;
  onClose: (() => void) | null;
  readonly closed: boolean;
}

/** Sec-WebSocket-Accept for a client key. */
export const acceptKey = (key: string): string =>
  createHash('sha1').update(key + WS_GUID).digest('base64');

/** One unmasked text frame (server→client frames MUST NOT be masked). */
export function encodeTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.from([0x80 | OPCODES.text, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | OPCODES.text;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | OPCODES.text;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

const encodeControl = (opcode: number, payload = Buffer.alloc(0)): Buffer =>
  Buffer.concat([Buffer.from([0x80 | opcode, payload.length]), payload]);

/**
 * Complete the upgrade handshake on `socket` and return a framed connection.
 * Caller routes on req.url first — this writes the 101 response.
 */
export function acceptWebSocket(req: IncomingMessage, socket: Duplex): WsConnection {
  const key = req.headers['sec-websocket-key'];
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${acceptKey(String(key ?? randomBytes(16).toString('base64')))}\r\n` +
      '\r\n',
  );

  let buf = Buffer.alloc(0);
  let fragments: Buffer[] = [];
  let closed = false;

  const conn: WsConnection = {
    send(text) {
      if (!closed) socket.write(encodeTextFrame(text));
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        socket.write(encodeControl(OPCODES.close));
        socket.end();
      } catch {
        /* already gone */
      }
      conn.onClose?.();
    },
    onMessage: null,
    onClose: null,
    get closed() {
      return closed;
    },
  };

  const die = () => {
    if (!closed) {
      closed = true;
      conn.onClose?.();
    }
  };

  // Parse as many complete frames as the buffer holds.
  const drain = () => {
    for (;;) {
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < off + 2) return;
        len = buf.readUInt16BE(off);
        off += 2;
      } else if (len === 127) {
        if (buf.length < off + 8) return;
        len = Number(buf.readBigUInt64BE(off));
        off += 8;
      }
      const maskLen = masked ? 4 : 0;
      if (buf.length < off + maskLen + len) return;
      let payload = buf.subarray(off + maskLen, off + maskLen + len);
      if (masked) {
        const mask = buf.subarray(off, off + 4);
        const un = Buffer.alloc(len);
        for (let i = 0; i < len; i++) un[i] = payload[i] ^ mask[i & 3];
        payload = un;
      }
      buf = buf.subarray(off + maskLen + len);

      if (opcode === OPCODES.close) {
        conn.close();
        return;
      }
      if (opcode === OPCODES.ping) {
        socket.write(encodeControl(OPCODES.pong, payload));
        continue;
      }
      if (opcode === OPCODES.pong) continue;
      if (opcode === OPCODES.text || opcode === OPCODES.continuation) {
        fragments.push(payload);
        if (fin) {
          const text = Buffer.concat(fragments).toString('utf8');
          fragments = [];
          conn.onMessage?.(text);
        }
      }
    }
  };

  socket.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    drain();
  });
  socket.on('error', die);
  socket.on('close', die);
  return conn;
}
