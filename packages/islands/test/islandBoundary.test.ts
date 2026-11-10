// @vitest-environment happy-dom
/**
 * Island error boundaries — mountIsland({ boundary }) covering the
 * breakable points: mount rejection (contract violation), runtime worker
 * crash (InProcessWorker.crash() → the client's lifecycle 'error'), manual
 * and policy-driven retry, and the state render functions' DOM output.
 * Fixture: ./fixtures/contract.worker.ts (checkout mounts with `count`,
 * rejects contract violations).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [() => import('./fixtures/contract.worker')];

let mountIsland: typeof import('../src/index').mountIsland;
let connectIslandWorker: typeof import('../src/index').connectIslandWorker;
let realDoc: Document;

beforeAll(async () => {
  realDoc = document;
  ({ mountIsland, connectIslandWorker } = await import('../src/index'));
});

const contractWorker = () =>
  new Worker(new URL('./fixtures/contract.worker.ts', import.meta.url), { type: 'module' });

const host = (): HTMLElement => {
  const el = realDoc.createElement('div');
  realDoc.body.appendChild(el);
  return el;
};

const errorNode = (ctx: { error: unknown; retry(): void }): HTMLElement => {
  const el = realDoc.createElement('div');
  el.className = 'boundary-error';
  el.textContent = `failed:${String((ctx.error as Error)?.message ?? ctx.error).slice(0, 40)}`;
  const btn = realDoc.createElement('button');
  btn.className = 'retry-btn';
  btn.addEventListener('click', () => ctx.retry());
  el.append(btn);
  return el;
};

describe('mount-failure boundary', () => {
  it('renders the error state instead of rejecting', async () => {
    const onError = vi.fn();
    const handle = await mountIsland({
      worker: contractWorker,
      el: host(),
      app: 'checkout',
      props: { count: 'nope' },
      boundary: { error: errorNode, onError },
    });
    expect(handle.state).toBe('error');
    expect(onError).toHaveBeenCalledWith(expect.anything(), 'mount');
    handle.destroy();
  });

  it('the el carries the error render output', async () => {
    const el = host();
    const handle = await mountIsland({
      worker: contractWorker,
      el,
      app: 'checkout',
      props: {},
      boundary: { error: errorNode },
    });
    expect(el.querySelector('.boundary-error')).not.toBeNull();
    handle.destroy();
  });

  it('loading runs before the first attempt', async () => {
    const loading = vi.fn(() => 'loading…');
    const handle = await mountIsland({
      worker: contractWorker,
      el: host(),
      app: 'checkout',
      props: { count: 1 },
      boundary: { loading },
    });
    expect(loading).toHaveBeenCalledOnce();
    expect(handle.state).toBe('mounted');
    handle.destroy();
  });

  it('manual retry remounts successfully — same handle, mounted state', async () => {
    const el = host();
    const handle = await mountIsland({
      worker: contractWorker,
      el,
      app: 'checkout',
      props: {},
      boundary: { error: errorNode },
    });
    expect(handle.state).toBe('error');
    // Fix the cause, then retry through the error render's hook.
    const btn = el.querySelector('.retry-btn') as HTMLButtonElement;
    // updateProps stashes into the next attempt's props.
    await handle.updateProps({ count: 5 });
    btn.click();
    await vi.waitFor(() => expect(handle.state).toBe('mounted'));
    expect(el.querySelector('.checkout')).not.toBeNull();
    handle.destroy();
  });
});

describe('runtime-crash boundary', () => {
  it('a worker crash swaps the island to the error state', async () => {
    const onError = vi.fn();
    const el = host();
    const handle = await mountIsland({
      worker: contractWorker,
      el,
      app: 'checkout',
      props: { count: 1 },
      boundary: { error: errorNode, onError },
    });
    expect(handle.state).toBe('mounted');
    const worker = InProcessWorker.created.at(-1)!;
    worker.crash('kaboom');
    await vi.waitFor(() => expect(handle.state).toBe('error'));
    expect(onError).toHaveBeenCalledWith(expect.anything(), 'runtime');
    expect(el.querySelector('.boundary-error')).not.toBeNull();
    handle.destroy();
  });

  it('auto-retry remounts into the respawned worker', async () => {
    const el = host();
    const handle = await mountIsland({
      worker: contractWorker,
      el,
      app: 'checkout',
      props: { count: 1 },
      boundary: { error: errorNode, retry: 2 },
    });
    expect(handle.state).toBe('mounted');
    InProcessWorker.created.at(-1)!.crash();
    // 'error' render → policy schedules a retry → respawned worker mounts.
    await vi.waitFor(() => expect(handle.state).toBe('mounted'), { timeout: 5000 });
    expect(el.querySelector('.checkout')).not.toBeNull();
    handle.destroy();
  });

  it('retry: fn returning false stops auto-remount', async () => {
    const policy = vi.fn(() => false as const);
    const handle = await mountIsland({
      worker: contractWorker,
      el: host(),
      app: 'checkout',
      props: { count: 1 },
      boundary: { error: errorNode, retry: policy },
    });
    InProcessWorker.created.at(-1)!.crash();
    await vi.waitFor(() => expect(handle.state).toBe('error'));
    expect(policy).toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 100));
    expect(handle.state).toBe('error'); // never auto-remounted
    handle.destroy();
  });

  it("domOnError: 'preserve' appends the fallback over the stale frame", async () => {
    const el = host();
    const handle = await mountIsland({
      worker: contractWorker,
      el,
      app: 'checkout',
      props: { count: 1 },
      boundary: { error: errorNode, domOnError: 'preserve' },
    });
    expect(el.querySelector('.checkout')).not.toBeNull();
    InProcessWorker.created.at(-1)!.crash();
    await vi.waitFor(() => expect(handle.state).toBe('error'));
    // Stale frame kept, fallback appended beside it.
    expect(el.querySelector('.checkout')).not.toBeNull();
    expect(el.querySelector('.boundary-error')).not.toBeNull();
    handle.destroy();
  });
});

describe('shared-client boundaries', () => {
  it('a crash notifies every island boundary on the client', async () => {
    const client = connectIslandWorker({ worker: contractWorker });
    const a = await mountIsland({
      client,
      el: host(),
      app: 'checkout',
      props: { count: 1 },
      boundary: { error: errorNode },
    });
    const b = await mountIsland({
      client,
      el: host(),
      app: 'checkout',
      props: { count: 2 },
      boundary: { error: errorNode },
    });
    InProcessWorker.created.at(-1)!.crash();
    await vi.waitFor(() => {
      expect(a.state).toBe('error');
      expect(b.state).toBe('error');
    });
    a.destroy();
    b.destroy();
  });
});
