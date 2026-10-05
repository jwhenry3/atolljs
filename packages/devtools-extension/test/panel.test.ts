// @vitest-environment happy-dom
/**
 * The dashboard's extension transport seam: app/main.js loaded on the real
 * index.html markup with `__ATOLL_TRANSPORT = 'extension'` must treat
 * `__ATOLL_BRIDGE` as its channel: announce, ingest frames, answer control
 * through it, and reset + re-announce on the bridge's navigation signal.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const appDir = `${resolve(__dirname, '../../devtools/app')}/`;

describe('main.js extension transport', () => {
  it('drives the dashboard through __ATOLL_BRIDGE', async () => {
    const html = readFileSync(`${appDir}index.html`, 'utf8');
    document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)![1].replace(/<script[\s\S]*?<\/script>/g, '');
    document.body.classList.add('ext');

    const posted: { type: string; [k: string]: unknown }[] = [];
    const bridge = {
      onmessage: null as null | ((m: { data: unknown }) => void),
      onreset: null as null | (() => void),
      postMessage: (m: { type: string }) => posted.push(m),
    };
    const w = window as unknown as Record<string, unknown>;
    w.__ATOLL_TRANSPORT = 'extension';
    w.__ATOLL_BRIDGE = bridge;
    // happy-dom canvases have no 2d context; the views only need a stub
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => new Proxy({}, {
      get: (_, k) => (k === 'measureText' ? () => ({ width: 0 }) : () => {}),
      set: () => true,
    }) as never);
    // happy-dom's <select>.length is getter-only; reset() truncates options with it
    Object.defineProperty(HTMLSelectElement.prototype, 'length', {
      configurable: true,
      get() { return this.options.length; },
      set(n: number) { while (this.options.length > n) this.remove(this.options.length - 1); },
    });

    await import('../../devtools/app/main.js');
    // main.js fills the rest of the panel API in at load time
    const { api } = (await import('../../devtools/app/api.js')) as { api: any };

    expect(api.transport).toBe('extension');
    expect(document.body.classList.contains('local')).toBe(true);
    expect(typeof bridge.onmessage).toBe('function');
    expect(typeof bridge.onreset).toBe('function');
    expect(posted).toContainEqual({ type: 'view' });

    const session = { id: 's-1', name: 'demo', runtime: 'browser' };
    bridge.onmessage!({ data: { type: 'hello', session } });
    bridge.onmessage!({ data: { type: 'batch', session, events: [{ type: 'pool:init', poolId: 'pool-1', size: 2, at: 1 }] } });
    expect(api.state.sessions.get('s-1')?.name).toBe('demo');

    const reply = api.control('s-1', 'echo', { a: 1 });
    const req = posted.find((m) => m.type === 'control' && m.cmd === 'echo')!;
    expect(req).toMatchObject({ sessionId: 's-1', args: { a: 1 } });
    bridge.onmessage!({ data: { type: 'control-result', sessionId: 's-1', id: req.id, ok: true, result: 42 } });
    await expect(reply).resolves.toBe(42);

    posted.length = 0;
    bridge.onreset!();
    expect(api.state.sessions.size).toBe(0);
    expect(posted).toContainEqual({ type: 'view' });

    // the shell's empty state speaks to the DevTools case
    expect(document.querySelector('.sh-wait')?.innerHTML).toContain('No atoll session on the inspected page');
  });
});
