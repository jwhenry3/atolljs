// @vitest-environment node
/**
 * RFC6455 framing edges — masked/unmasked decode, the three length tiers,
 * fragmentation, ping/pong and close over real sockets, and the Node
 * client's handshake-failure and server-frame paths.
 */
import { createServer, connect as netConnect, type Server, type Socket } from 'node:net';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  acceptWebSocket,
  decodeFrames,
  encodeMaskedControl,
  encodeMaskedTextFrame,
  encodeTextFrame,
  OPCODES,
  type WsConnection,
} from '../src/ws';
import { connectNodeWebSocket } from '../src/nodeWs';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('frame codec', () => {
  it.each([10, 200, 70_000])('masked text frames round-trip at len %s', (n) => {
    const text = 'x'.repeat(n);
    const { frames, rest } = decodeFrames(encodeMaskedTextFrame(text));
    expect(rest.length).toBe(0);
    expect(frames).toHaveLength(1);
    expect(frames[0].payload.toString('utf8')).toBe(text);
    expect(frames[0].fin).toBe(true);
    expect(frames[0].opcode).toBe(OPCODES.text);
  });

  it('decodes unmasked server frames and fragmented messages', () => {
    // fin=0 text + fin=1 continuation reassembles server-side.
    const a = Buffer.from('hel');
    const b = Buffer.from('lo');
    const f1 = Buffer.concat([Buffer.from([OPCODES.text, a.length]), a]);
    const f2 = Buffer.concat([Buffer.from([0x80 | OPCODES.continuation, b.length]), b]);
    const { frames, rest } = decodeFrames(Buffer.concat([f1, f2]));
    expect(rest.length).toBe(0);
    expect(frames.map((f) => [f.fin, f.opcode])).toEqual([
      [false, OPCODES.text],
      [true, OPCODES.continuation],
    ]);

    // Unmasked text frame (the server→client shape) decodes too.
    const plain = decodeFrames(encodeTextFrame('hi'));
    expect(plain.frames[0].payload.toString('utf8')).toBe('hi');
  });

  it('keeps an incomplete frame as rest until the remainder arrives', () => {
    const full = encodeMaskedTextFrame('split-me');
    const first = decodeFrames(full.subarray(0, 5));
    expect(first.frames).toHaveLength(0);
    expect(first.rest.length).toBe(5);
    const second = decodeFrames(Buffer.concat([first.rest, full.subarray(5)]));
    expect(second.frames[0].payload.toString('utf8')).toBe('split-me');
  });

  it('masked control frames decode with their opcode intact', () => {
    const { frames } = decodeFrames(encodeMaskedControl(OPCODES.ping, Buffer.from('p')));
    expect(frames[0].opcode).toBe(OPCODES.ping);
    expect(frames[0].payload.toString('utf8')).toBe('p');
  });
});

describe('acceptWebSocket', () => {
  const withServer = async (): Promise<{
    server: Server;
    port: number;
    connReady: Promise<WsConnection>;
  }> => {
    let gotConn!: (c: WsConnection) => void;
    const connReady = new Promise<WsConnection>((r) => (gotConn = r));
    const server = createServer((socket) => {
      gotConn(
        acceptWebSocket(
          { headers: { 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' } } as IncomingMessage,
          socket,
        ),
      );
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    return { server, port, connReady };
  };

  it('answers a masked ping with an unmasked pong', async () => {
    const { server, port, connReady } = await withServer();
    try {
      const sock = netConnect(port, '127.0.0.1');
      const chunks: Buffer[] = [];
      sock.on('data', (c: Buffer) => chunks.push(c));
      await connReady;
      sock.write(encodeMaskedControl(OPCODES.ping, Buffer.from('z')));
      await wait(50);
      // First chunk: the 101 handshake; the pong follows.
      const all = Buffer.concat(chunks);
      const pong = decodeFrames(all.subarray(all.indexOf('\r\n\r\n') + 4));
      expect(pong.frames[0].opcode).toBe(OPCODES.pong);
      expect(pong.frames[0].payload.toString('utf8')).toBe('z');
      sock.destroy();
    } finally {
      server.close();
    }
  });

  it('reassembles fragmented masked text and calls onMessage once', async () => {
    const { server, port, connReady } = await withServer();
    try {
      const got: string[] = [];
      const sock = netConnect(port, '127.0.0.1');
      const conn = await connReady;
      conn.onMessage = (t) => got.push(t);
      // Two masked fragments: fin=0 text 'fra', fin=1 continuation 'me'.
      const mask = Buffer.from([1, 2, 3, 4]);
      const frag = (fin: boolean, op: number, s: string) => {
        const p = Buffer.from(s);
        for (let i = 0; i < p.length; i++) p[i] ^= mask[i & 3];
        return Buffer.concat([
          Buffer.from([(fin ? 0x80 : 0) | op, 0x80 | p.length]),
          mask,
          p,
        ]);
      };
      sock.write(Buffer.concat([frag(false, OPCODES.text, 'fra'), frag(true, OPCODES.continuation, 'me')]));
      await wait(80);
      expect(got).toEqual(['frame']);
      sock.destroy();
    } finally {
      server.close();
    }
  });

  it('a masked close frame from the client closes the connection', async () => {
    const { server, port, connReady } = await withServer();
    try {
      const sock = netConnect(port, '127.0.0.1');
      const conn = await connReady;
      const closed = new Promise<void>((r) => {
        conn.onClose = () => r();
      });
      sock.write(encodeMaskedControl(OPCODES.close));
      await closed;
      expect(conn.closed).toBe(true);
      conn.close(); // idempotent second call
      sock.destroy();
    } finally {
      server.close();
    }
  });
});

describe('connectNodeWebSocket edges', () => {
  it('dies on a non-101 handshake response', async () => {
    const server = createServer((socket) => {
      socket.on('data', () => {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    try {
      const sock = connectNodeWebSocket(`ws://127.0.0.1:${port}/events`);
      const closed = new Promise<void>((r) => (sock.onClose = r));
      await closed;
      expect(sock.open).toBe(false);
      sock.close(); // second close is a no-op
    } finally {
      server.close();
    }
  });

  it('pongs server pings, drains text frames, and closes on a close frame', async () => {
    const serverWrites: Buffer[] = [];
    let serverSock: Socket;
    const server = createServer((socket) => {
      serverSock = socket;
      // Answer the upgrade request with a minimal 101 — no WS server needed.
      socket.once('data', (c: Buffer) => {
        serverWrites.push(c);
        socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
        socket.on('data', (c: Buffer) => serverWrites.push(c));
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    try {
      const sock = connectNodeWebSocket(`ws://127.0.0.1:${port}/events`);
      await new Promise<void>((r) => {
        sock.onOpen = r;
        setTimeout(r, 400);
      });
      expect(sock.open).toBe(true);
      await wait(30);
      serverWrites.length = 0; // drop the handshake request

      // Server → client: a ping — the client must pong (masked, opcode 10).
      serverSock!.write(Buffer.concat([
        Buffer.from([0x80 | OPCODES.ping, 1]),
        Buffer.from('q'),
      ]));
      await wait(60);
      const pong = decodeFrames(Buffer.concat(serverWrites));
      expect(pong.frames[0].opcode).toBe(OPCODES.pong);
      expect(pong.frames[0].payload.toString('utf8')).toBe('q');

      // A text frame — drained (the client never reads payloads).
      serverSock!.write(encodeTextFrame('{"type":"sessions"}'));
      await wait(30);

      // A close frame — the client closes itself.
      const closed = new Promise<void>((r) => (sock.onClose = r));
      serverSock!.write(Buffer.from([0x80 | OPCODES.close, 0]));
      await closed;
      expect(sock.open).toBe(false);
    } finally {
      server.close();
    }
  });

  it('close() before the upgrade ends the socket without writing a close frame', async () => {
    const writes: Buffer[] = [];
    const server = createServer((socket) => {
      socket.on('data', (c: Buffer) => writes.push(c));
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    try {
      const sock = connectNodeWebSocket(`ws://127.0.0.1:${port}/events`);
      await wait(60); // let the TCP connect + upgrade request land
      const request = Buffer.concat(writes).toString('latin1');
      expect(request).toContain('Upgrade: websocket');
      sock.close();
      expect(sock.open).toBe(false);
      await wait(40);
      // open was false → close() skips the masked close frame — the server
      // only ever saw the HTTP request.
      const all = Buffer.concat(writes);
      expect(all.length).toBe(request.length);
      sock.close(); // idempotent
    } finally {
      server.close();
    }
  });
});
