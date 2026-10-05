import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addDevtoolsSink,
  devtoolsEnabled,
  emitDevtools,
  forwardDevtools,
  setDevtoolsSink,
  type EmittedDevtoolsEvent,
} from './devtools';
import { WorkerPool } from './pool/workerPool';

class InitWorker {
  public sent: any[] = [];
  constructor(public url: URL, public options: any) {}
  postMessage(data: any) { this.sent.push(data); }
  addEventListener() {}
  removeEventListener() {}
  terminate() {}
}

describe('additive devtools sinks', () => {
  const removers: (() => void)[] = [];
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const r of removers.splice(0)) r();
    setDevtoolsSink(null);
  });

  it('fans one stamped event out to the transport and every listener', () => {
    const a: EmittedDevtoolsEvent[] = [];
    const b: EmittedDevtoolsEvent[] = [];
    const c: EmittedDevtoolsEvent[] = [];
    setDevtoolsSink((e) => a.push(e));
    removers.push(addDevtoolsSink((e) => b.push(e)), addDevtoolsSink((e) => c.push(e)));
    emitDevtools({ type: 'pool:terminate', poolId: 'p' });
    expect(a).toHaveLength(1);
    expect(b[0]).toBe(a[0]);
    expect(c[0]).toBe(a[0]);
  });

  it('works without a transport and keeps devtoolsEnabled() on', () => {
    expect(devtoolsEnabled()).toBe(false);
    const got: EmittedDevtoolsEvent[] = [];
    const off = addDevtoolsSink((e) => got.push(e));
    expect(devtoolsEnabled()).toBe(true);
    forwardDevtools({ type: 'pool:terminate', poolId: 'p', at: 5, thread: 'worker' });
    expect(got[0].at).toBe(5);
    off();
    expect(devtoolsEnabled()).toBe(false);
  });

  it('clearing the transport leaves listeners installed', () => {
    const got: EmittedDevtoolsEvent[] = [];
    setDevtoolsSink(() => {});
    removers.push(addDevtoolsSink((e) => got.push(e)));
    setDevtoolsSink(null);
    expect(devtoolsEnabled()).toBe(true);
    emitDevtools({ type: 'pool:terminate', poolId: 'p' });
    expect(got).toHaveLength(1);
  });

  it('isolates a throwing listener from its siblings and the app', () => {
    const got: EmittedDevtoolsEvent[] = [];
    removers.push(
      addDevtoolsSink(() => { throw new Error('bad listener'); }),
      addDevtoolsSink((e) => got.push(e)),
    );
    expect(() => emitDevtools({ type: 'pool:terminate', poolId: 'p' })).not.toThrow();
    expect(got).toHaveLength(1);
  });

  it('remover is idempotent', () => {
    const off = addDevtoolsSink(() => {});
    off();
    off();
    expect(devtoolsEnabled()).toBe(false);
  });

  it('a listener alone turns on worker forwarding in the INIT handshake', () => {
    vi.stubGlobal('Worker', InitWorker);
    let w: InitWorker | undefined;
    vi.stubGlobal('Worker', class extends InitWorker {
      constructor(u: URL, o: any) { super(u, o); w = this; }
    });
    removers.push(addDevtoolsSink(() => {}));
    const pool = new WorkerPool({ workerUrl: new URL('https://example.test/w.ts'), poolSize: 1 });
    expect(w!.sent[0]).toMatchObject({ type: 'INIT', devtools: true });
    pool.terminate();
  });
});
