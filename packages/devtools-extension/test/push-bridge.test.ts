// @vitest-environment node
/**
 * The panel bridge: listener gating, status transitions, outbox until a page
 * attaches, reset on navigation, frame validation both ways, keepalive pings,
 * and reconnecting (with a reset) when the service worker port drops.
 */
import { describe, expect, it, vi } from 'vitest';
import { PANEL_PORT } from '../src/frames.js';
import { STATUS_LABELS, createPushBridge } from '../src/push-bridge.js';
import { portPair, type FakePort } from './fakeChrome';

type Msg = { type: string; [k: string]: unknown };
const session = { id: 's-1', runtime: 'browser' };
const fast = { reconnectMs: [5, 10], pingMs: 60_000 };

/** A connect() whose far ends (the "hub") the test drives directly. */
function fakeHub() {
  const hubs: { port: FakePort; got: Msg[] }[] = [];
  const connect = vi.fn(({ name }: { name: string }) => {
    const [mine, theirs] = portPair(name);
    const got: Msg[] = [];
    theirs.onMessage.addListener((m: Msg) => got.push(m));
    hubs.push({ port: theirs, got });
    return mine;
  });
  const hub = () => hubs.at(-1)!;
  const tell = (msg: Msg) => hub().port.postMessage(msg);
  return { connect, hubs, hub, tell };
}

function make(opts: { tabId?: number | null; pingMs?: number } = {}) {
  const h = fakeHub();
  const bridge = createPushBridge({
    connect: h.connect, tabId: opts.tabId === undefined ? 42 : opts.tabId, options: { ...fast, pingMs: opts.pingMs ?? fast.pingMs },
  });
  const got: Msg[] = [];
  const statuses: string[] = [];
  bridge.onstatus = (s: string) => statuses.push(s);
  return { ...h, bridge, got, statuses, listen: () => { bridge.onmessage = (m: { data: Msg }) => got.push(m.data); } };
}

describe('push bridge', () => {
  it('connects once a listener exists, holds viewer frames until a page attaches, then goes live', async () => {
    const t = make();
    await new Promise((r) => setTimeout(r, 10));
    expect(t.connect).not.toHaveBeenCalled(); // no onmessage yet: frames would be lost
    expect(t.bridge.status).toBe('connecting');
    expect(t.bridge.label).toBe(STATUS_LABELS.connecting);

    t.listen();
    t.bridge.postMessage({ type: 'view' }); // what main.js connect() sends right away
    t.bridge.postMessage({ type: 'dismiss', sessionId: 's-1' }); // not a page frame: dropped
    expect(t.connect).toHaveBeenCalledWith({ name: PANEL_PORT });
    await vi.waitFor(() => expect(t.hub().got).toEqual([{ type: 'init', tabId: 42 }]));

    t.tell({ type: 'attached' });
    await vi.waitFor(() => expect(t.hub().got).toContainEqual({ type: 'frame', frame: { type: 'view' } }));
    expect(t.bridge.status).toBe('waiting');
    expect(t.bridge.label).toBe('no atoll session');

    t.tell({ type: 'frame', frame: { type: 'hello' } }); // malformed: filtered
    t.tell({ type: 'frame', frame: { type: 'bye', sessionId: 's-0' } });
    await vi.waitFor(() => expect(t.got).toEqual([{ type: 'bye', sessionId: 's-0' }]));
    expect(t.bridge.status).toBe('waiting'); // bye alone isn't a live session
    t.tell({ type: 'frame', frame: { type: 'hello', session } });
    await vi.waitFor(() => expect(t.bridge.status).toBe('live'));
    expect(t.bridge.label).toBe('inspected page');
    expect(t.statuses).toEqual(['waiting', 'live']);

    // attached: frames go straight out, as JSON copies
    const ctl = { type: 'control', sessionId: 's-1', id: 'c1', cmd: 'echo', args: { a: 1 } };
    t.bridge.postMessage(ctl);
    await vi.waitFor(() => expect(t.hub().got.at(-1)).toEqual({ type: 'frame', frame: ctl }));
    t.bridge.close();
  });

  it('page-gone then reset: clears the outbox and lets the dashboard reset and re-announce', async () => {
    const t = make();
    const onreset = vi.fn(() => t.bridge.postMessage({ type: 'view' })); // main.js: reset() + reannounce()
    t.bridge.onreset = onreset;
    t.listen();
    t.tell({ type: 'attached' });
    t.tell({ type: 'frame', frame: { type: 'hello', session } });
    await vi.waitFor(() => expect(t.bridge.status).toBe('live'));

    t.tell({ type: 'page-gone' });
    await vi.waitFor(() => expect(t.bridge.status).toBe('connecting'));
    t.tell({ type: 'frame', frame: { type: 'bye', sessionId: 's-1' } }); // between pages: ignored
    t.bridge.postMessage({ type: 'control', sessionId: 's-1', id: 'stale', cmd: 'x' }); // for the old page
    t.tell({ type: 'reset' });
    await vi.waitFor(() => expect(onreset).toHaveBeenCalledTimes(1));
    expect(t.bridge.status).toBe('waiting');
    await vi.waitFor(() => expect(t.hub().got.at(-1)).toEqual({ type: 'frame', frame: { type: 'view' } }));
    expect(t.hub().got.some((m) => (m.frame as Msg | undefined)?.id === 'stale')).toBe(false);
    expect(t.got).toEqual([{ type: 'hello', session }]);
    t.bridge.close();
  });

  it('without an onreset handler a reset re-sends view itself', async () => {
    const t = make();
    t.listen();
    t.tell({ type: 'attached' });
    t.tell({ type: 'reset' });
    await vi.waitFor(() => expect(t.hub().got).toContainEqual({ type: 'frame', frame: { type: 'view' } }));
    t.bridge.close();
  });

  it('maps hub status reports while no page is attached', async () => {
    const t = make();
    t.listen();
    t.tell({ type: 'status', status: 'no-content-script' });
    await vi.waitFor(() => expect(t.bridge.status).toBe('reload'));
    expect(t.bridge.label).toBe('reload the page to connect');
    t.tell({ type: 'status', status: 'unreachable' });
    await vi.waitFor(() => expect(t.bridge.status).toBe('unreachable'));
    expect(t.bridge.label).toBe('page not inspectable');
    t.tell({ type: 'attached' });
    t.tell({ type: 'status', status: 'no-content-script' }); // stale: a page is attached
    await vi.waitFor(() => expect(t.bridge.status).toBe('waiting'));
    await new Promise((r) => setTimeout(r, 5));
    expect(t.bridge.status).toBe('waiting');
    t.bridge.close();
  });

  it('reconnects when the hub port drops, re-sends init, and resets on the next attach', async () => {
    const t = make();
    const onreset = vi.fn();
    t.bridge.onreset = onreset;
    t.listen();
    t.tell({ type: 'attached' });
    await vi.waitFor(() => expect(t.bridge.status).toBe('waiting'));
    expect(onreset).not.toHaveBeenCalled();

    t.hub().port.disconnect(); // service worker terminated
    await vi.waitFor(() => expect(t.bridge.status).toBe('connecting'));
    await vi.waitFor(() => expect(t.connect).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(t.hub().got).toEqual([{ type: 'init', tabId: 42 }]));
    t.tell({ type: 'attached' }); // frames may have been missed in between
    await vi.waitFor(() => expect(onreset).toHaveBeenCalledTimes(1));
    t.bridge.close();
  });

  it('pings to keep the service worker alive and nudges only while detached', async () => {
    const t = make({ pingMs: 20 });
    t.listen();
    await vi.waitFor(() => expect(t.hub().got.filter((m) => m.type === 'ping').length).toBeGreaterThanOrEqual(2));
    t.bridge.nudge();
    await vi.waitFor(() => expect(t.hub().got).toContainEqual({ type: 'nudge' }));
    t.tell({ type: 'attached' });
    await vi.waitFor(() => expect(t.bridge.status).toBe('waiting'));
    const n = t.hub().got.filter((m) => m.type === 'nudge').length;
    t.bridge.nudge();
    await new Promise((r) => setTimeout(r, 5));
    expect(t.hub().got.filter((m) => m.type === 'nudge').length).toBe(n);
    t.bridge.close();
  });

  it('close() disconnects and stops reconnecting and pinging', async () => {
    const t = make({ pingMs: 20 });
    t.listen();
    await vi.waitFor(() => expect(t.hub().got).toContainEqual({ type: 'init', tabId: 42 }));
    const gone = vi.fn();
    t.hub().port.onDisconnect.addListener(gone);
    t.bridge.close();
    await vi.waitFor(() => expect(gone).toHaveBeenCalled());
    const before = t.hub().got.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(t.connect).toHaveBeenCalledTimes(1);
    expect(t.hub().got).toHaveLength(before);
    t.bridge.postMessage({ type: 'view' });
    expect(t.hub().got).toHaveLength(before);
  });

  it('is unreachable without a tab id or an extension context, retrying the latter', async () => {
    const none = make({ tabId: null });
    none.listen();
    expect(none.connect).not.toHaveBeenCalled();
    expect(none.bridge.status).toBe('unreachable');

    const t = make();
    t.connect.mockImplementationOnce(() => { throw new Error('Extension context invalidated.'); });
    t.listen();
    expect(t.bridge.status).toBe('unreachable');
    await vi.waitFor(() => expect(t.connect).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(t.hub().got).toEqual([{ type: 'init', tabId: 42 }]));
    t.bridge.close();
  });

  it('caps the outbox while no page is attached', async () => {
    const h = fakeHub();
    const bridge = createPushBridge({ connect: h.connect, tabId: 1, options: { ...fast, outboxCap: 2 } });
    bridge.onmessage = () => {};
    for (const id of ['a', 'b', 'c']) bridge.postMessage({ type: 'control', sessionId: 's', id, cmd: 'x' });
    h.tell({ type: 'attached' });
    await vi.waitFor(() => expect(h.hub().got.filter((m) => m.type === 'frame').map((m) => (m.frame as Msg).id)).toEqual(['b', 'c']));
    bridge.close();
  });
});
