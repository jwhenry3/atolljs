import { describe, expect, it, vi } from 'vitest';
import { createRoot } from 'solid-js';
import { defineSharedMemory, defineTask, field, observe } from '@jwhenry123/mesh/sdk';
import { createObservable, createSharedValue, createTask } from '../src/index';

const mem = defineSharedMemory({ n: field.number(), label: field.string({ maxBytes: 64 }) });
mem.bind(new SharedArrayBuffer(mem.totalBytes));

describe('createObservable', () => {
  it('returns an accessor tracking the observable', async () => {
    let accessor!: () => number | undefined;
    createRoot(() => {
      accessor = createObservable(observe(mem, 'n')) as () => number | undefined;
    });
    mem.n.write(7);
    await vi.waitFor(() => expect(accessor()).toBe(7));
  });

  it('stops updating after root disposal', async () => {
    let accessor!: () => number | undefined;
    const dispose = createRoot((d) => {
      accessor = createObservable(observe(mem, 'n')) as () => number | undefined;
      return d;
    });
    mem.n.write(1);
    await vi.waitFor(() => expect(accessor()).toBe(1));
    dispose();
    mem.n.write(2);
    await new Promise((r) => setTimeout(r, 30));
    expect(accessor()).toBe(1);
  });
});

describe('createSharedValue', () => {
  it('binds a field and applies the selector', async () => {
    let raw!: () => string | undefined, doubled!: () => number | undefined;
    createRoot(() => {
      raw = createSharedValue(mem, 'label') as () => string | undefined;
      doubled = createSharedValue(mem, 'n', (v) => (v ?? 0) * 2) as () => number | undefined;
    });
    mem.label.write('cell');
    mem.n.write(8);
    await vi.waitFor(() => {
      expect(raw()).toBe('cell');
      expect(doubled()).toBe(16);
    });
  });
});

describe('createTask', () => {
  it('exposes a state accessor and run triggers', async () => {
    const task = defineTask(async (n: number) => n - 1);
    let t!: { state: () => { data: number | null; settled: boolean } };
    createRoot(() => {
      t = createTask(task) as typeof t;
    });
    expect(t.state().settled).toBe(false);
    t.run(10);
    await vi.waitFor(() => expect(t.state().data).toBe(9));
  });
});
