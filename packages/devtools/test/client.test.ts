// @vitest-environment node
/**
 * connectDevtools transport internals — session identity, the lazy
 * nodeWs fallback when no global WebSocket exists (Node < 22 shape),
 * buffer caps, and close semantics.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emitDevtools, setDevtoolsSink } from '@atolljs/core';
import { connectDevtools, type DevtoolsConnection } from '@atolljs/devtools';
import { createDevtoolsServer, type DevtoolsServer } from '@atolljs/devtools/server';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One WebSocket to /view collecting parsed viewer messages. */
const viewer = (url: string) => {
  const ws = new WebSocket(`${url}/view`);
  const msgs: any[] = [];
  ws.onmessage = (m) => msgs.push(JSON.parse(m.data));
  return { ws, msgs };
};

describe('connectDevtools', () => {
  let server: DevtoolsServer | undefined;
  let conn: DevtoolsConnection | undefined;
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    conn?.close();
    for (const s of sockets) s.close();
    sockets.length = 0;
    await server?.close();
    setDevtoolsSink(null);
    vi.unstubAllGlobals();
    server = undefined;
    conn = undefined;
  });

  it('derives session identity from options and the node runtime', () => {
    conn = connectDevtools({
      url: 'ws://127.0.0.1:1/events', // nothing listening — stays buffered
      session: { name: 'unit-app' },
      flushMs: 10,
      network: false,
      memory: false,
    });
    expect(conn.session.name).toBe('unit-app');
    expect(conn.session.runtime).toBe('node');
    expect(conn.session.hint).toBe(process.title);
    expect(conn.open).toBe(false); // socket never upgraded
  });

  it('loads the bundled nodeWs client when no global WebSocket exists', async () => {
    server = await createDevtoolsServer({ port: 0 });
    const wsUrl = server.url.replace('http://', 'ws://');
    // Node < 22 shape — forces client.ts's lazy './nodeWs.ts' import.
    vi.stubGlobal('WebSocket', undefined);

    conn = connectDevtools({ url: `${wsUrl}/events`, session: { name: 'fallback' }, flushMs: 10, network: false, memory: false });
    await wait(150); // dynamic import + handshake

    expect(conn.open).toBe(true);
    emitDevtools({ type: 'pool:terminate', poolId: 'pool-7' });
    await wait(80);
    expect(server.sessions().map((s) => s.name)).toContain('fallback');
  });

  it('url alone implies the websocket transport even with BroadcastChannel around', async () => {
    server = await createDevtoolsServer({ port: 0 });
    conn = connectDevtools({ url: `${server.url.replace('http://', 'ws://')}/events`, session: { name: 'ws-picked' }, flushMs: 10, network: false, memory: false });
    await wait(100);
    expect(conn.open).toBe(true);
    expect(server.sessions().map((s) => s.name)).toContain('ws-picked');
  });

  it('explicit broadcast transport works without a window', async () => {
    const listener = new BroadcastChannel('atoll-devtools');
    const msgs: any[] = [];
    listener.onmessage = (m) => msgs.push(m.data);
    try {
      conn = connectDevtools({ transport: 'broadcast', session: { name: 'bc-node' }, flushMs: 10, network: false, memory: false });
      await wait(50);
      expect(conn.open).toBe(true);
      expect(msgs.some((m) => m.type === 'hello' && m.session.name === 'bc-node')).toBe(true);
    } finally {
      listener.close();
    }
  });

  it('drops oldest events once the pending buffer exceeds bufferCap', async () => {
    server = await createDevtoolsServer({ port: 0 });
    const wsUrl = server.url.replace('http://', 'ws://');
    const v = viewer(wsUrl);
    sockets.push(v.ws);

    // Emits land in the pending buffer synchronously — the socket is still
    // handshaking — so the cap trims before the first flush.
    conn = connectDevtools({ url: `${wsUrl}/events`, bufferCap: 3, flushMs: 10, network: false, memory: false });
    for (let i = 0; i < 6; i++) {
      emitDevtools({ type: 'worker:spawn', poolId: 'pool-1', slot: i });
    }
    await wait(150);
    const slots = v.msgs
      .filter((m) => m.type === 'batch')
      .flatMap((m) => m.events)
      .filter((e: any) => e.type === 'worker:spawn')
      .map((e: any) => e.slot);
    expect(slots).toEqual([3, 4, 5]);
  });

  it('stops emitting after close — sink uninstalled, socket closed', async () => {
    server = await createDevtoolsServer({ port: 0 });
    const wsUrl = server.url.replace('http://', 'ws://');
    conn = connectDevtools({ url: `${wsUrl}/events`, session: { name: 'closing' }, flushMs: 10, network: false, memory: false });
    await wait(100);
    conn.close();
    conn = undefined;

    const v = viewer(wsUrl);
    sockets.push(v.ws);
    await wait(80);
    emitDevtools({ type: 'pool:terminate', poolId: 'pool-x' });
    await wait(60);
    const events = v.msgs
      .filter((m) => m.type === 'batch')
      .flatMap((m) => m.events);
    expect(events).toHaveLength(0); // nothing arrived post-close
  });
});
