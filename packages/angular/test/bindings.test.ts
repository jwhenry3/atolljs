import { describe, expect, it, vi } from 'vitest';
import { createEnvironmentInjector, runInInjectionContext, type EnvironmentInjector } from '@angular/core';
import { defineSharedMemory, defineTask, field, observe } from '@jwhenry123/mesh/sdk';
import { observableSignal, sharedValue, taskState } from '../src/index';

const mem = defineSharedMemory({ n: field.number(), label: field.string(64) });
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
