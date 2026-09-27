import { describe, expect, it, vi } from 'vitest';
import { createEnvironmentInjector, runInInjectionContext, type EnvironmentInjector } from '@angular/core';
import { defineSharedMemory, defineTask, field, observe, WorkerPool } from '@jwhenry123/mesh/sdk';
import { injectMeshPool, observableSignal, provideMesh, sharedValue, taskState } from '../src/index';

const mem = defineSharedMemory({ n: field.number(), label: field.string({ maxBytes: 64 }) });
mem.bind(new SharedArrayBuffer(mem.totalBytes));

let env: EnvironmentInjector;
const inCtx = <T>(fn: () => T): T => {
  env ??= createEnvironmentInjector([], null);
  return runInInjectionContext(env, fn);
};

describe('observableSignal', () => {
  it('returns a signal tracking the observable', async () => {
    const sig = inCtx(() => observableSignal(observe(mem, 'n')));
    mem.n.write(13);
    await vi.waitFor(() => expect(sig()).toBe(13));
  });
});

describe('sharedValue', () => {
  it('binds a field and applies the selector', async () => {
    const raw = inCtx(() => sharedValue(mem, 'label'));
    const doubled = inCtx(() => sharedValue(mem, 'n', (v) => (v ?? 0) * 2));
    mem.label.write('tower');
    mem.n.write(9);
    await vi.waitFor(() => {
      expect(raw()).toBe('tower');
      expect(doubled()).toBe(18);
    });
  });
});

describe('taskState', () => {
  it('exposes a state signal and run triggers', async () => {
    const task = defineTask(async (n: number) => n + 100);
    const t = inCtx(() => taskState(task));
    expect(t.state().settled).toBe(false);
    t.run(1);
    await vi.waitFor(() => expect(t.state().data).toBe(101));
  });
});

describe('provideMesh / injectMeshPool', () => {
  it('registers a supplied pool under its name and terminates on injector destroy', () => {
    const pool = { terminate: vi.fn() } as unknown as WorkerPool;
    const injector = createEnvironmentInjector(
      [provideMesh({ pools: [{ name: 'x', pool: () => pool }] })],
      null,
    );
    const injected = runInInjectionContext(injector, () => injectMeshPool('x'));
    expect(injected).toBe(pool);

    injector.destroy();
    expect(pool.terminate).toHaveBeenCalled();
  });

  it('spawns an inline worker declaration eagerly with its shared contract', () => {
    const spawned: FakeWorker[] = [];
    class FakeWorker {
      public messages: unknown[] = [];
      constructor() {
        spawned.push(this);
      }
      postMessage(m: unknown) {
        this.messages.push(m);
      }
      addEventListener() {}
      removeEventListener() {}
      terminate() {}
    }

    const injector = createEnvironmentInjector(
      [
        provideMesh({
          pools: [
            {
              name: 'inline',
              worker: () => new FakeWorker() as unknown as Worker,
              sharedMemory: mem,
              poolSize: 2,
            },
          ],
        }),
      ],
      null,
    );
    try {
      const pool = runInInjectionContext(injector, () => injectMeshPool('inline'));
      expect(pool).toBeInstanceOf(WorkerPool);
      // ENVIRONMENT_INITIALIZER ran at injector creation — workers spawned
      // eagerly and each got the contract's INIT_MEMORY handshake.
      expect(spawned).toHaveLength(2);
      expect((spawned[0].messages[0] as { type: string }).type).toBe('INIT_MEMORY');
    } finally {
      injector.destroy();
    }
  });

  it('defaults the first pool name to "default"', () => {
    const pool = { terminate: vi.fn() } as unknown as WorkerPool;
    const injector = createEnvironmentInjector([provideMesh({ pools: [{ pool: () => pool }] })], null);
    expect(runInInjectionContext(injector, () => injectMeshPool())).toBe(pool);
    injector.destroy();
  });
});
