// @vitest-environment happy-dom
/**
 * installJankProbe — long-frame observer + rAF frame sampler, against a
 * mocked PerformanceObserver and a manually-driven requestAnimationFrame.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDevtoolsSink, type EmittedDevtoolsEvent } from '@atolljs/core';
import { installJankProbe } from '../src/probes';

class FakeObserver {
  static supportedEntryTypes: string[] = ['long-animation-frame', 'longtask'];
  static instances: FakeObserver[] = [];
  observed: unknown[] = [];
  disconnected = false;
  constructor(public cb: (list: { getEntries(): unknown[] }) => void) { FakeObserver.instances.push(this); }
  observe(opts: unknown) { this.observed.push(opts); }
  disconnect() { this.disconnected = true; }
  fire(entries: unknown[]) { this.cb({ getEntries: () => entries }); }
}

let frameCbs: Array<(t: number) => void> = [];
let cancelled = 0;
const step = (t: number) => {
  const cbs = frameCbs;
  frameCbs = [];
  for (const cb of cbs) cb(t);
};

describe('installJankProbe', () => {
  let events: EmittedDevtoolsEvent[];
  beforeEach(() => {
    events = [];
    setDevtoolsSink((e) => events.push(e));
    FakeObserver.instances = [];
    FakeObserver.supportedEntryTypes = ['long-animation-frame', 'longtask'];
    frameCbs = [];
    cancelled = 0;
    vi.stubGlobal('PerformanceObserver', FakeObserver);
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => { frameCbs.push(cb); return frameCbs.length; });
    vi.stubGlobal('cancelAnimationFrame', () => { cancelled++; frameCbs = []; });
  });
  afterEach(() => {
    setDevtoolsSink(null);
    vi.unstubAllGlobals();
  });

  it('emits runtime:longframe from LoAF entries with capped, sorted script attribution', () => {
    const release = installJankProbe();
    const obs = FakeObserver.instances[0];
    expect(obs.observed[0]).toEqual({ type: 'long-animation-frame', buffered: true });
    obs.fire([{
      duration: 180.4,
      blockingDuration: 130.2,
      scripts: Array.from({ length: 7 }, (_, i) => ({
        duration: i * 10, sourceURL: `https://app.test/s${i}.js`, sourceFunctionName: i === 6 ? '' : `fn${i}`, invoker: 'click',
      })),
    }]);
    const e = events.find((x) => x.type === 'runtime:longframe') as any;
    expect(e).toMatchObject({ ms: 180, blockingMs: 130 });
    expect(e.scripts).toHaveLength(5);
    expect(e.scripts[0]).toEqual({ src: 'https://app.test/s6.js', fn: 'click', ms: 60 });
    expect(e.scripts.map((s: any) => s.ms)).toEqual([60, 50, 40, 30, 20]);
    release();
    expect(obs.disconnected).toBe(true);
  });

  it('falls back to longtask, deriving blocking time past the 50ms budget', () => {
    FakeObserver.supportedEntryTypes = ['longtask'];
    const release = installJankProbe();
    const obs = FakeObserver.instances[0];
    expect(obs.observed[0]).toEqual({ type: 'longtask', buffered: true });
    obs.fire([{ duration: 120 }]);
    const e = events.find((x) => x.type === 'runtime:longframe');
    expect(e).toMatchObject({ ms: 120, blockingMs: 70 });
    expect(e).not.toHaveProperty('scripts');
    release();
  });

  it('skips throttled renders with no work: no blocking and under 50ms of script', () => {
    const release = installJankProbe();
    FakeObserver.instances[0].fire([
      { duration: 1005, blockingDuration: 0, scripts: [] },
      { duration: 914, blockingDuration: 0, scripts: [{ duration: 13 }, { duration: 8 }] },
      { duration: 120, blockingDuration: 0, scripts: [{ duration: 60 }] },
    ]);
    const lf = events.filter((x) => x.type === 'runtime:longframe') as any[];
    expect(lf.map((e) => e.ms)).toEqual([120]);
    release();
  });

  it('while hidden, reports only frames with ≥100ms of script, flagged hidden', () => {
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const release = installJankProbe();
    FakeObserver.instances[0].fire([
      { duration: 1000, blockingDuration: 40, scripts: [{ duration: 90 }] },
      { duration: 1000, blockingDuration: 200, scripts: [{ duration: 250 }] },
    ]);
    const lf = events.filter((x) => x.type === 'runtime:longframe') as any[];
    expect(lf).toHaveLength(1);
    expect(lf[0]).toMatchObject({ ms: 1000, blockingMs: 200, hidden: true });
    release();
    vis.mockRestore();
  });

  it('samples fps once a second and counts frames over 2x the interval as dropped', () => {
    const release = installJankProbe();
    let t = 1000;
    step(t); // first frame anchors the window
    for (let i = 0; i < 50; i++) step((t += 16));
    step((t += 100)); // one long frame
    while (t < 2000) step((t += 16)); // until the 1s window closes
    const f = events.filter((x) => x.type === 'runtime:frames') as any[];
    expect(f).toHaveLength(1);
    expect(f[0].dropped).toBe(1);
    expect(f[0].fps).toBeGreaterThan(45);
    expect(f[0].fps).toBeLessThan(60);
    release();
  });

  it('ignores hidden-tab stalls instead of reporting them as jank', () => {
    const release = installJankProbe();
    step(1000);
    step(1016);
    step(9000); // tab came back after 8s
    for (let t = 9016; t < 9900; t += 16) step(t);
    expect(events.filter((x) => x.type === 'runtime:frames')).toHaveLength(0);
    release();
  });

  it('is idempotent and reference-counted across connections', () => {
    const a = installJankProbe();
    const b = installJankProbe();
    expect(FakeObserver.instances).toHaveLength(1);
    expect(frameCbs).toHaveLength(1);
    a();
    a(); // double release is a no-op
    expect(FakeObserver.instances[0].disconnected).toBe(false);
    expect(cancelled).toBe(0);
    b();
    expect(FakeObserver.instances[0].disconnected).toBe(true);
    expect(cancelled).toBe(1);
  });

  it('is a no-op outside a browser main thread', () => {
    vi.stubGlobal('window', undefined);
    const release = installJankProbe();
    expect(FakeObserver.instances).toHaveLength(0);
    expect(frameCbs).toHaveLength(0);
    release();
  });
});
