// @vitest-environment node
/**
 * The content-script relay: passive until the hub's attach message, then a
 * validated push bridge between the page's BroadcastChannel and a runtime
 * port, back to passive when the port drops.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installContentRelay } from '../src/content.js';
import { ATTACH, CHANNEL, PAGE_PORT, isAppFrame, isViewerFrame } from '../src/frames.js';
import { FakeEvent, portPair, type FakePort } from './fakeChrome';

type Frame = { type: string; [k: string]: unknown };
const session = { id: 's-1', runtime: 'browser' };
const opened: BroadcastChannel[] = [];
afterEach(() => { for (const bc of opened.splice(0)) bc.close(); });

/** The app side of the page's channel. */
const appChannel = () => {
  const bc = new BroadcastChannel(CHANNEL);
  opened.push(bc);
  const got: Frame[] = [];
  bc.onmessage = (e) => got.push(e.data);
  return { bc, got };
};

/** A content-script runtime whose connect() hands back the hub's end. */
const fakeRuntime = () => {
  const hubEnds: FakePort[] = [];
  const runtime = {
    onMessage: new FakeEvent(),
    connect: vi.fn(({ name }: { name: string }) => {
      const [mine, theirs] = portPair(name);
      hubEnds.push(theirs);
      return mine;
    }),
  };
  const attach = () => {
    let res: unknown;
    runtime.onMessage.emit({ type: ATTACH }, { id: 'ext' }, (r: unknown) => { res = r; });
    return res;
  };
  return { runtime, hubEnds, attach };
};

/** BroadcastChannel spy that records instances so the test can close them. */
const trackedChannel = () => {
  const made: BroadcastChannel[] = [];
  class Tracked extends BroadcastChannel {
    constructor(name: string) { super(name); made.push(this); opened.push(this); }
  }
  return { Tracked: Tracked as typeof BroadcastChannel, made };
};

describe('frame shape checks', () => {
  it('accepts app frames and rejects viewer or malformed ones', () => {
    expect(isAppFrame({ type: 'hello', session })).toBe(true);
    expect(isAppFrame({ type: 'batch', session, events: [] })).toBe(true);
    expect(isAppFrame({ type: 'bye', sessionId: 's-1' })).toBe(true);
    expect(isAppFrame({ type: 'control-result', sessionId: 's-1', id: 'c1', ok: true })).toBe(true);
    expect(isAppFrame({ type: 'batch', session, events: 'nope' })).toBe(false);
    expect(isAppFrame({ type: 'hello' })).toBe(false);
    expect(isAppFrame({ type: 'view' })).toBe(false);
    expect(isAppFrame(null)).toBe(false);
    expect(isViewerFrame({ type: 'view' })).toBe(true);
    expect(isViewerFrame({ type: 'control', sessionId: 's-1', id: 'c1', cmd: 'x' })).toBe(true);
    expect(isViewerFrame({ type: 'control', sessionId: 's-1' })).toBe(false);
    expect(isViewerFrame({ type: 'dismiss', sessionId: 's-1' })).toBe(false);
    expect(isViewerFrame(7)).toBe(false);
  });
});

describe('content relay', () => {
  it('stays passive until attach: no port, no channel', () => {
    const { runtime } = fakeRuntime();
    const { Tracked, made } = trackedChannel();
    const relay = installContentRelay({ runtime, BroadcastChannel: Tracked });
    expect(runtime.onMessage.listeners.size).toBe(1);
    expect(runtime.connect).not.toHaveBeenCalled();
    expect(made).toHaveLength(0);
    expect(relay.attached).toBe(false);

    // unrelated messages get no response and change nothing
    const sendResponse = vi.fn();
    const ret = [...runtime.onMessage.listeners][0]({ type: 'other' }, {}, sendResponse);
    expect(ret).toBeUndefined();
    expect(sendResponse).not.toHaveBeenCalled();
    expect(runtime.connect).not.toHaveBeenCalled();
  });

  it('attaches once, pushes validated app frames and posts validated viewer frames', async () => {
    const app = appChannel();
    const { runtime, hubEnds, attach } = fakeRuntime();
    const { Tracked, made } = trackedChannel();
    const relay = installContentRelay({ runtime, BroadcastChannel: Tracked });

    expect(attach()).toEqual({ ok: true });
    expect(attach()).toEqual({ ok: true }); // idempotent
    expect(runtime.connect).toHaveBeenCalledTimes(1);
    expect(runtime.connect).toHaveBeenCalledWith({ name: PAGE_PORT });
    expect(made).toHaveLength(1);
    expect(relay).toMatchObject({ attached: true, channelOpen: true });

    const hub = hubEnds[0];
    const fromPage: Frame[] = [];
    hub.onMessage.addListener((m: Frame) => fromPage.push(m));
    app.bc.postMessage({ type: 'hello', session });
    app.bc.postMessage({ type: 'view' }); // another dashboard's ping: not relayed
    app.bc.postMessage({ type: 'hello' }); // malformed
    app.bc.postMessage({ type: 'bye', sessionId: 'big', n: 1n }); // cloneable, not JSON: dropped
    app.bc.postMessage({ type: 'batch', session, events: [{ type: 'pool:init' }] });
    await vi.waitFor(() => expect(fromPage.map((f) => f.type)).toEqual(['hello', 'batch']));

    hub.postMessage({ type: 'view' });
    hub.postMessage({ type: 'dismiss', sessionId: 's-1' });
    hub.postMessage({ type: 'control', sessionId: 's-1', id: 'c1', cmd: 'devtools.commands' });
    await vi.waitFor(() => expect(app.got).toEqual([
      { type: 'view' },
      { type: 'control', sessionId: 's-1', id: 'c1', cmd: 'devtools.commands' },
    ]));
  });

  it('closes the channel and goes passive when the port drops, then re-attaches', async () => {
    const app = appChannel();
    const { runtime, hubEnds, attach } = fakeRuntime();
    const { Tracked, made } = trackedChannel();
    const relay = installContentRelay({ runtime, BroadcastChannel: Tracked });
    attach();
    const close = vi.spyOn(made[0], 'close');
    hubEnds[0].disconnect(); // panel closed: hub drops the page port
    await vi.waitFor(() => expect(relay.attached).toBe(false));
    expect(close).toHaveBeenCalled();
    expect(relay.channelOpen).toBe(false);

    expect(attach()).toEqual({ ok: true });
    expect(runtime.connect).toHaveBeenCalledTimes(2);
    const fromPage: Frame[] = [];
    hubEnds[1].onMessage.addListener((m: Frame) => fromPage.push(m));
    app.bc.postMessage({ type: 'bye', sessionId: 's-1' });
    await vi.waitFor(() => expect(fromPage).toEqual([{ type: 'bye', sessionId: 's-1' }]));
  });

  it('reports failure when the extension context is gone', () => {
    const { runtime, attach } = fakeRuntime();
    const { Tracked, made } = trackedChannel();
    runtime.connect.mockImplementation(() => { throw new Error('Extension context invalidated.'); });
    const relay = installContentRelay({ runtime, BroadcastChannel: Tracked });
    expect(attach()).toEqual({ ok: false });
    expect(relay.attached).toBe(false);
    expect(made).toHaveLength(1);

    const broken = class { constructor() { throw new Error('no channel'); } } as unknown as typeof BroadcastChannel;
    const r2 = fakeRuntime();
    installContentRelay({ runtime: r2.runtime, BroadcastChannel: broken });
    expect(r2.attach()).toEqual({ ok: false });
    expect(r2.runtime.connect).not.toHaveBeenCalled();
  });
});
