// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emitDevtools } from '@atolljs/core';
import { exportOtel, localResource, type OtelExporter } from '../src/otel';

describe('exportOtel in a browser window', () => {
  let exp: OtelExporter | undefined;
  afterEach(async () => {
    await exp?.close();
    exp = undefined;
  });

  const start = () => {
    const calls: RequestInit[] = [];
    const f = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      calls.push(init!);
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    exp = exportOtel({ fetch: f, flushIntervalMs: 0, signals: { metrics: false }, network: false, memory: false, jank: false });
    return calls;
  };

  it('flushes with keepalive on pagehide', async () => {
    const calls = start();
    emitDevtools({ type: 'island:task', instance: 'a@1', method: 'flush', ms: 1 });
    window.dispatchEvent(new Event('pagehide'));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].keepalive).toBe(true);
  });

  it('stops listening for pagehide after close', async () => {
    const calls = start();
    await exp!.close();
    window.dispatchEvent(new Event('pagehide'));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(0);
  });

  it('identifies itself as webjs with the user agent', () => {
    const attrs = localResource('web');
    expect(attrs).toContainEqual({ key: 'telemetry.sdk.language', value: { stringValue: 'webjs' } });
    expect(attrs.some((a) => a.key === 'user_agent.original')).toBe(true);
  });
});
