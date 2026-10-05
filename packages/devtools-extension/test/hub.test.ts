// @vitest-environment node
/**
 * Service worker routing: pairing panel and page ports by tab id, the
 * top-frame filter, reset/page-gone around navigations, attach retries and
 * status reports, and teardown when the panel leaves.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHANNEL, PAGE_PORT, PANEL_PORT } from '../src/frames.js';
import { createHub } from '../src/hub.js';
import { NO_RECEIVER, createFakeChrome, type FakePort } from './fakeChrome';

type Msg = { type: string; [k: string]: unknown };
const session = { id: 's-1', runtime: 'browser' };
const fast = { retryMs: [5, 10, 15], slowMs: 25 };
const opened: BroadcastChannel[] = [];
afterEach(() => { for (const bc of opened.splice(0)) bc.close(); });

const appChannel = () => {
  const bc = new BroadcastChannel(CHANNEL);
  opened.push(bc);
  const got: Msg[] = [];
  bc.onmessage = (e) => got.push(e.data);
  return { bc, got };
};

function setup(options = fast) {
  const fake = createFakeChrome();
  const hub = createHub({ runtime: fake.chrome.runtime, tabs: fake.chrome.tabs, options });
  const panel = (tabId: number) => {
    const port = fake.connectPanel({ name: PANEL_PORT }) as FakePort;
    const got: Msg[] = [];
    port.onMessage.addListener((m: Msg) => got.push(m));
    port.postMessage({ type: 'init', tabId });
    const types = () => got.filter((m) => m.type !== 'frame').map((m) => (m.type === 'status' ? `status:${m.status}` : m.type));
    const frames = () => got.filter((m) => m.type === 'frame').map((m) => m.frame as Msg);
    return { port, got, types, frames };
  };
  return { fake, hub, panel };
}

describe('hub', () => {
  it('pairs the tab\'s top-frame page port with its panel and relays validated frames', async () => {
    const { fake, hub, panel } = setup();
    const app = appChannel();
    const { relay } = fake.load(7);
    const p = panel(7);
    await vi.waitFor(() => expect(p.types()).toEqual(['attached']));
    expect(fake.chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { type: 'atoll-attach' }, { frameId: 0 });
    expect(relay.attached).toBe(true);
    expect(hub.tabs).toEqual([{ tabId: 7, panels: 1, page: true }]);

    app.bc.postMessage({ type: 'hello', session });
    await vi.waitFor(() => expect(p.frames()).toEqual([{ type: 'hello', session }]));

    p.port.postMessage({ type: 'frame', frame: { type: 'view' } });
    p.port.postMessage({ type: 'frame', frame: { type: 'dismiss', sessionId: 's-1' } });
    p.port.postMessage({ type: 'ping' });
    await vi.waitFor(() => expect(app.got).toEqual([{ type: 'view' }]));
  });

  it('refuses page ports from child frames, unknown tabs, and malformed page data', async () => {
    const { fake, panel } = setup();
    const p = panel(3);
    await vi.waitFor(() => expect(p.types()).toEqual(['status:no-content-script']));

    const child = fake.connectFrom(PAGE_PORT, { tab: { id: 3 }, frameId: 2 });
    const stranger = fake.connectFrom(PAGE_PORT, { tab: { id: 99 }, frameId: 0 });
    const noTab = fake.connectFrom(PAGE_PORT, {});
    const childGone = vi.fn();
    child.onDisconnect.addListener(childGone);
    await vi.waitFor(() => expect([child.connected, stranger.connected, noTab.connected]).toEqual([false, false, false]));
    expect(childGone).toHaveBeenCalled();

    const top = fake.connectFrom(PAGE_PORT, { tab: { id: 3 }, frameId: 0 });
    await vi.waitFor(() => expect(p.types()).toContain('attached'));
    top.postMessage({ type: 'hello' });
    top.postMessage({ type: 'view' });
    top.postMessage({ type: 'bye', sessionId: 's-1' });
    await vi.waitFor(() => expect(p.frames()).toEqual([{ type: 'bye', sessionId: 's-1' }]));
  });

  it('on navigation: page-gone, quiet retries, then reset when the new page attaches', async () => {
    const { fake, panel } = setup({ retryMs: [100, 100, 100], slowMs: 25 });
    fake.load(5);
    const p = panel(5);
    await vi.waitFor(() => expect(p.types()).toEqual(['attached']));

    fake.unload(5); // old document gone; the new one's content script isn't there yet
    await vi.waitFor(() => expect(p.types()).toEqual(['attached', 'page-gone']));
    const before = fake.chrome.tabs.sendMessage.mock.calls.length;
    await vi.waitFor(() => expect(fake.chrome.tabs.sendMessage.mock.calls.length).toBeGreaterThan(before), { interval: 2 });
    await new Promise((r) => setTimeout(r, 5));
    expect(p.types()).toEqual(['attached', 'page-gone']); // no "reload" flash during fast retries
    await vi.waitFor(() => expect(p.types()).toEqual(['attached', 'page-gone', 'status:no-content-script']));

    const app = appChannel();
    fake.load(5);
    await vi.waitFor(() => expect(p.types()).toEqual(['attached', 'page-gone', 'status:no-content-script', 'reset']));
    p.port.postMessage({ type: 'frame', frame: { type: 'view' } });
    await vi.waitFor(() => expect(app.got).toEqual([{ type: 'view' }]));
  });

  it('reports a missing content script, keeps retrying slowly, and attaches after a reload', async () => {
    const { fake, panel } = setup();
    const p = panel(4);
    await vi.waitFor(() => expect(p.types()).toEqual(['status:no-content-script']));
    const n = fake.chrome.tabs.sendMessage.mock.calls.length;
    await vi.waitFor(() => expect(fake.chrome.tabs.sendMessage.mock.calls.length).toBeGreaterThan(n + 3));
    expect(p.types()).toEqual(['status:no-content-script']); // reported once

    fake.load(4); // user reloaded the tab
    await vi.waitFor(() => expect(p.types()).toEqual(['status:no-content-script', 'attached']));
  });

  it('reports other attach failures as unreachable', async () => {
    const { fake, panel } = setup();
    fake.failSends('No tab with id: 8.');
    const p = panel(8);
    await vi.waitFor(() => expect(p.types()).toEqual(['status:unreachable']));
    fake.failSends(null);
    fake.load(8);
    await vi.waitFor(() => expect(p.types()).toEqual(['status:unreachable', 'attached']));
  });

  it('disconnects the page port when the last panel leaves', async () => {
    const { fake, hub, panel } = setup();
    const { relay } = fake.load(6);
    const a = panel(6);
    await vi.waitFor(() => expect(a.types()).toEqual(['attached']));
    const b = panel(6); // a second panel on the same tab joins the live page
    await vi.waitFor(() => expect(b.types()).toEqual(['attached']));
    expect(fake.chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);

    a.port.disconnect();
    await new Promise((r) => setTimeout(r, 10));
    expect(relay.attached).toBe(true);
    b.port.disconnect();
    await vi.waitFor(() => expect(relay.attached).toBe(false));
    expect(relay.channelOpen).toBe(false);
    expect(hub.tabs).toEqual([]);
  });

  it('stops retrying once the panel leaves, and re-attaches on a nudge', async () => {
    const { fake, panel } = setup();
    const p = panel(9);
    await vi.waitFor(() => expect(p.types()).toEqual(['status:no-content-script']));
    fake.load(9);
    p.port.postMessage({ type: 'nudge' });
    await vi.waitFor(() => expect(p.types()).toContain('attached'));

    const q = panel(10);
    await vi.waitFor(() => expect(q.types()).toEqual(['status:no-content-script']));
    q.port.disconnect();
    await new Promise((r) => setTimeout(r, 10));
    const n = fake.chrome.tabs.sendMessage.mock.calls.filter(([t]) => t === 10).length;
    await new Promise((r) => setTimeout(r, 60));
    expect(fake.chrome.tabs.sendMessage.mock.calls.filter(([t]) => t === 10).length).toBe(n);
  });

  it('moves a panel to another tab on a new init', async () => {
    const { fake, hub, panel } = setup();
    const first = fake.load(1);
    fake.load(2);
    const p = panel(1);
    await vi.waitFor(() => expect(p.types()).toEqual(['attached']));
    p.port.postMessage({ type: 'init', tabId: 2 });
    await vi.waitFor(() => expect(hub.tabs).toEqual([{ tabId: 2, panels: 1, page: true }]));
    expect(first.relay.attached).toBe(false);
  });
});
