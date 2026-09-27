import { describe, expect, it, vi } from 'vitest';
import { defineSharedMemory, defineTask, field, observe } from '@jwhenry123/mesh/sdk';
import { observableValue, sharedValue, taskState } from '../src/reactivity.svelte';
import { inRoot } from './root.svelte';

const mem = defineSharedMemory({ n: field.number(), label: field.string({ maxBytes: 64 }) });
mem.bind(new SharedArrayBuffer(mem.totalBytes));

describe('observableValue', () => {
  it('wraps an observable in rune state', async () => {
    const { value: v, destroy } = inRoot(() => observableValue(observe(mem, 'n')));
    mem.n.write(5);
    await vi.waitFor(() => expect(v.value).toBe(5));
    destroy();
  });

  it('stops updating when the owning root is destroyed', async () => {
    const { value: v, destroy } = inRoot(() => observableValue(observe(mem, 'n')));
    // $effect registers its teardown on the first scheduled flush — let it run
    await new Promise((r) => setTimeout(r, 30));
    destroy();
    mem.n.write(77);
    await new Promise((r) => setTimeout(r, 30));
    expect(v.value).not.toBe(77);
  });
});

describe('sharedValue', () => {
  it('binds a field and applies the selector', async () => {
    const { value: raw, destroy } = inRoot(() => sharedValue(mem, 'label'));
    const { value: doubled } = inRoot(() => sharedValue(mem, 'n', (v) => (v ?? 0) * 2));
    mem.label.write('ran');
    mem.n.write(6);
    await vi.waitFor(() => {
      expect(raw.value).toBe('ran');
      expect(doubled.value).toBe(12);
    });
    destroy();
  });
});

describe('taskState', () => {
  it('exposes snapshot getters plus run/runOnce', async () => {
    const task = defineTask(async (n: number) => n * 10);
    const { value: t } = inRoot(() => taskState(task));
    expect(t.settled).toBe(false);
    t.run(4);
    await vi.waitFor(() => expect(t.data).toBe(40));
    expect(t.settled).toBe(true);
    expect(t.pending).toBe(false);
  });

  it('accepts a plain async fn and reaches settled', async () => {
    const { value: t } = inRoot(() => taskState(async (n: number) => n + 1));
    t.run(9);
    await vi.waitFor(() => expect(t.settled).toBe(true));
    expect(t.data).toBe(10);
  });
});
