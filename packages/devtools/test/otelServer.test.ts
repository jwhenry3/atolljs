// @vitest-environment node
/**
 * Aggregate-server OTLP forwarding: an app session streams events over
 * /events and the server exports them with a per-session resource.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emitDevtools, setDevtoolsSink } from '@atolljs/core';
import { connectDevtools, type DevtoolsConnection } from '@atolljs/devtools';
import { createDevtoolsServer, type DevtoolsServer } from '@atolljs/devtools/server';

describe('devtools server → OTLP', () => {
  let server: DevtoolsServer | undefined;
  let conn: DevtoolsConnection | undefined;

  afterEach(async () => {
    conn?.close();
    await server?.close();
    setDevtoolsSink(null);
    server = undefined;
    conn = undefined;
  });

  it('exports ingested batches with the session as the resource', async () => {
    const bodies: { path: string; body: any }[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      bodies.push({ path: new URL(String(url)).pathname, body: JSON.parse(String(init!.body)) });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    server = await createDevtoolsServer({
      port: 0,
      otlp: { endpoint: 'http://otel.test:4318', fetch: fetchMock, flushIntervalMs: 0 },
    });
    const wsUrl = server.url.replace('http://', 'ws://');
    conn = connectDevtools({ url: `${wsUrl}/events`, session: { name: 'orders-api' }, flushMs: 10, network: false, memory: false, jank: false });
    await vi.waitFor(() => expect(server!.sessions()).toHaveLength(1));

    emitDevtools({ type: 'task:enqueue', poolId: 'pool-1', callId: 1, taskId: 'charge' });
    emitDevtools({ type: 'task:settle', poolId: 'pool-1', callId: 1, taskId: 'charge', outcome: 'error', runMs: 3, error: 'declined' });
    // closing the session releases its mapper; server.close() flushes the tail
    await new Promise((r) => setTimeout(r, 100));
    await server.close();
    server = undefined;

    const traces = bodies.find((b) => b.path === '/v1/traces')!.body;
    const rs = traces.resourceSpans[0];
    expect(rs.resource.attributes).toEqual(expect.arrayContaining([
      { key: 'service.name', value: { stringValue: 'orders-api' } },
      { key: 'telemetry.sdk.language', value: { stringValue: 'nodejs' } },
    ]));
    expect(rs.resource.attributes.find((a: any) => a.key === 'service.instance.id').value.stringValue).toMatch(/^s-/);
    const span = rs.scopeSpans[0].spans[0];
    expect(span).toMatchObject({ name: 'atoll.task charge', status: { code: 2, message: 'declined' } });
    // remote clock rebased onto the server's receive time
    const endMs = Number(BigInt(span.endTimeUnixNano) / 1_000_000n);
    expect(Math.abs(endMs - Date.now())).toBeLessThan(5000);
    expect(bodies.some((b) => b.path === '/v1/metrics')).toBe(true);
  });

  it('forwards nothing when otlp is not configured', async () => {
    server = await createDevtoolsServer({ port: 0 });
    expect(server.url).toMatch(/^http:/);
  });
});
