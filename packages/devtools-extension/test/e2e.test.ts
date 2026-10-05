// @vitest-environment node
/**
 * End to end with the real broadcast transport
 * (packages/devtools/src/broadcast.ts): app -> BroadcastChannel -> content
 * relay -> page port -> hub -> panel port -> push bridge, over the in-memory
 * chrome fakes. A late panel gets hello plus the replayed tail, control
 * round-trips, and a reload resets the panel onto the new session.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emitDevtools, registerDevtoolsCommand, setDevtoolsSink } from '@atolljs/core';
import { connectDevtools, type DevtoolsConnection } from '@atolljs/devtools';
import { createHub } from '../src/hub.js';
import { createPushBridge } from '../src/push-bridge.js';
import { createFakeChrome } from './fakeChrome';

type Frame = { type: string; [k: string]: unknown };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TAB = 11;

let conn: DevtoolsConnection | undefined;
afterEach(() => {
  conn?.close();
  conn = undefined;
  setDevtoolsSink(null);
});

const start = () => connectDevtools({
  transport: 'broadcast', session: { name: 'e2e' }, flushMs: 5, network: false, memory: false, jank: false,
});

describe('end to end with the real broadcast transport', () => {
  it('late panel gets hello + replayed history, control round-trips, reload resets', async () => {
    const fake = createFakeChrome();
    createHub({ runtime: fake.chrome.runtime, tabs: fake.chrome.tabs, options: { retryMs: [5, 10], slowMs: 20 } });
    const page = fake.load(TAB);

    conn = start();
    const off = registerDevtoolsCommand('echo', (args: Record<string, unknown>) => ({ echoed: args }));
    emitDevtools({ type: 'task:enqueue', poolId: 'pool-1', callId: 1, taskId: 'ping' });
    await wait(30); // flushed into the app's replay tail before any panel exists
    expect(page.relay.attached).toBe(false);

    const bridge = createPushBridge({ connect: fake.connectPanel, tabId: TAB });
    const got: Frame[] = [];
    const resets = vi.fn(() => bridge.postMessage({ type: 'view' })); // main.js: reset() + reannounce()
    bridge.onreset = resets;
    bridge.onmessage = (m: { data: Frame }) => got.push(m.data);
    bridge.postMessage({ type: 'view' }); // what main.js connect() sends
    await vi.waitFor(() => {
      expect(got.some((f) => f.type === 'hello' && (f.session as { name?: string }).name === 'e2e')).toBe(true);
      const events = got.filter((f) => f.type === 'batch').flatMap((f) => f.events as { type: string }[]);
      expect(events.map((e) => e.type)).toContain('task:enqueue');
    });
    expect(bridge.status).toBe('live');
    expect(page.relay.attached).toBe(true);

    // live push: a new event arrives without any polling
    emitDevtools({ type: 'task:enqueue', poolId: 'pool-1', callId: 2, taskId: 'pong' });
    await vi.waitFor(() => expect(got.filter((f) => f.type === 'batch')
      .flatMap((f) => f.events as { taskId?: string }[]).some((e) => e.taskId === 'pong')).toBe(true));

    const sessionId = conn.session.id;
    bridge.postMessage({ type: 'control', sessionId, id: 'c1', cmd: 'echo', args: { a: 1 } });
    await vi.waitFor(() => expect(got).toContainEqual({
      type: 'control-result', sessionId, id: 'c1', ok: true, result: { echoed: { a: 1 } },
    }));

    // reload: old document and session go away, a new one starts and gets attached
    conn.close();
    fake.unload(TAB);
    await vi.waitFor(() => expect(bridge.status).not.toBe('live'));
    const reloaded = fake.load(TAB);
    conn = start();
    await vi.waitFor(() => expect(resets).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(got.some((f) => f.type === 'hello' && (f.session as { id: string }).id === conn!.session.id)).toBe(true));
    expect(conn.session.id).not.toBe(sessionId);
    expect(bridge.status).toBe('live');

    // panel closed: the content script goes passive
    bridge.close();
    await vi.waitFor(() => expect(reloaded.relay.attached).toBe(false));
    expect(reloaded.relay.channelOpen).toBe(false);
    off();
  });
});
