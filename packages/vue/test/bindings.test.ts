import { describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { defineSharedMemory, defineTask, field, observe } from '@atolljs/core/sdk';
import { useObservable, useSharedValue, useTask } from '../src/index';

const mem = defineSharedMemory({ n: field.number(), label: field.string({ maxBytes: 64 }) });
mem.bind(new SharedArrayBuffer(mem.totalBytes));

describe('useObservable', () => {
  it('returns a ref tracking the observable', async () => {
    const scope = effectScope();
    const value = scope.run(() => useObservable(observe(mem, 'n')))!;
    expect(value.value).toBe(0); // number fields read 0 until first write
    mem.n.write(11);
    await vi.waitFor(() => expect(value.value).toBe(11));
    scope.stop();
  });

  it('stops updating after scope disposal', async () => {
    const scope = effectScope();
    const value = scope.run(() => useObservable(observe(mem, 'n')))!;
    scope.stop();
    mem.n.write(99);
    await new Promise((r) => setTimeout(r, 30));
    expect(value.value).not.toBe(99);
  });
});

describe('useSharedValue', () => {
  it('binds a field and applies the selector', async () => {
    const scope = effectScope();
    const raw = scope.run(() => useSharedValue(mem, 'label'))!;
    const doubled = scope.run(() => useSharedValue(mem, 'n', (v) => (v ?? 0) * 2))!;
    mem.label.write('net');
    mem.n.write(3);
    await vi.waitFor(() => {
      expect(raw.value).toBe('net');
      expect(doubled.value).toBe(6);
    });
    scope.stop();
  });
});

describe('useTask', () => {
  it('exposes a state ref and run triggers', async () => {
    const task = defineTask(async (n: number) => n * 3);
    const scope = effectScope();
    const t = scope.run(() => useTask(task))!;
    expect(t.state.value.settled).toBe(false);
    t.run(4);
    await vi.waitFor(() => expect(t.state.value.data).toBe(12));
    expect(t.state.value.settled).toBe(true);
    scope.stop();
  });

  it('accepts a plain async fn and reaches settled', async () => {
    const scope = effectScope();
    const t = scope.run(() => useTask(async (n: number) => n * 2))!;
    t.run(6);
    await vi.waitFor(() => expect(t.state.value.settled).toBe(true));
    expect(t.state.value.data).toBe(12);
    scope.stop();
  });
});
