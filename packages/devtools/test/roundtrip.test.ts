// @vitest-environment node
/**
 * Functional round-trip: devtools server + connectDevtools client over real
 * WebSockets. Exercises the ws.ts framing (masked client frames in,
 * unmasked server frames out), hello/batch protocol, and viewer fan-out.
 */
import { afterEach, describe, expect, it } from 'vitest';
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

describe('devtools server + client', () => {
  let server: DevtoolsServer | undefined;
  let conn: DevtoolsConnection | undefined;
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    conn?.close();
    for (const s of sockets) s.close();
    await server?.close();
    setDevtoolsSink(null);
    server = undefined;
    conn = undefined;
  });

  it('ingests events over /events and fans them out to /view', async () => {
    server = await createDevtoolsServer({ port: 0 });
    const wsUrl = server.url.replace('http://', 'ws://');
    const v = viewer(wsUrl);
    sockets.push(v.ws);

    conn = connectDevtools({ url: `${wsUrl}/events`, session: { name: 'roundtrip' }, flushMs: 10 });
    await wait(100); // hello + handshake

    emitDevtools({ type: 'task:enqueue', poolId: 'pool-1', callId: 1, taskId: 'ping' });
    emitDevtools({
      type: 'task:settle', poolId: 'pool-1', callId: 1, taskId: 'ping', outcome: 'ok', runMs: 3,
    });
    await wait(100); // flush + fan-out

    expect(server.sessions().map((s) => s.name)).toContain('roundtrip');
    const batches = v.msgs.filter((m) => m.type === 'batch');
    const events = batches.flatMap((b) => b.events.map((e: any) => e.type));
    expect(events).toContain('task:enqueue');
    expect(events).toContain('task:settle');
    expect(batches[0].session.name).toBe('roundtrip');
    // stamped fields survive the trip
    const enq = batches.flatMap((b) => b.events).find((e: any) => e.type === 'task:enqueue');
    expect(enq.at).toBeTypeOf('number');
    expect(enq.thread).toBe('main');
  });

  it('serves the dashboard and a health endpoint', async () => {
    server = await createDevtoolsServer({ port: 0 });
    const res = await fetch(`${server.url}/health`);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    const page = await fetch(`${server.url}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('atoll devtools');
  });

  it('late-joining viewers get the session list and replayed tail', async () => {
    server = await createDevtoolsServer({ port: 0, replayBatches: 10 });
    const wsUrl = server.url.replace('http://', 'ws://');
    conn = connectDevtools({ url: `${wsUrl}/events`, session: { name: 'early' }, flushMs: 10 });
    await wait(100);
    emitDevtools({ type: 'pool:terminate', poolId: 'pool-9' });
    await wait(100);

    const v = viewer(wsUrl);
    sockets.push(v.ws);
    await wait(100);
    const kinds = v.msgs.map((m) => m.type);
    expect(kinds[0]).toBe('sessions');
    expect(v.msgs[0].sessions.map((s: any) => s.name)).toContain('early');
    expect(v.msgs.some((m) => m.type === 'batch')).toBe(true);
  });

  it('dismissing a closed session drops it and purges its replayed tail', async () => {
    server = await createDevtoolsServer({ port: 0, replayBatches: 50 });
    const wsUrl = server.url.replace('http://', 'ws://');
    conn = connectDevtools({ url: `${wsUrl}/events`, session: { name: 'short-lived' }, flushMs: 10 });
    await wait(100);
    const sessionId = conn.session.id;
    emitDevtools({ type: 'pool:terminate', poolId: 'pool-1' });
    await wait(100);
    conn.close(); // session becomes closed/ended server-side
    conn = undefined;
    await wait(100);

    const v = viewer(wsUrl);
    sockets.push(v.ws);
    await wait(100);
    expect(v.msgs[0].sessions.some((s: any) => s.id === sessionId)).toBe(true);
    expect(v.msgs.some((m) => m.type === 'batch' && m.session.id === sessionId)).toBe(true);

    v.ws.send(JSON.stringify({ type: 'dismiss', sessionId }));
    await wait(100);

    const last = v.msgs.filter((m) => m.type === 'sessions').at(-1);
    expect(last.sessions.some((s: any) => s.id === sessionId)).toBe(false);

    // A fresh viewer sees neither the session nor its replayed batches.
    const v2 = viewer(wsUrl);
    sockets.push(v2.ws);
    await wait(100);
    expect(v2.msgs[0].sessions.some((s: any) => s.id === sessionId)).toBe(false);
    expect(v2.msgs.some((m) => m.type === 'batch' && m.session.id === sessionId)).toBe(false);
  });
});
