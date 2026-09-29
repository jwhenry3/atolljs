import { describe, expect, it } from 'vitest';
import { MemoryManager } from './memory';

describe('MemoryManager', () => {
  it('creates shared memory with the default limits', () => {
    const mm = new MemoryManager();
    expect(mm.memory.buffer.byteLength).toBe(16 * 65536);
  });

  it('grows the buffer to fit ensureCapacity requests', () => {
    const mm = new MemoryManager({ initialPages: 16, maximumPages: 64 });
    mm.ensureCapacity(20 * 65536 + 1);
    expect(mm.memory.buffer.byteLength).toBeGreaterThanOrEqual(21 * 65536);
  });

  it('does not grow when capacity already suffices', () => {
    const mm = new MemoryManager({ initialPages: 16, maximumPages: 64 });
    const before = mm.memory.buffer.byteLength;
    mm.ensureCapacity(before - 100);
    expect(mm.memory.buffer.byteLength).toBe(before);
  });

  it('throws when growth would exceed maximumPages', () => {
    const mm = new MemoryManager({ initialPages: 16, maximumPages: 20 });
    expect(() => mm.ensureCapacity(21 * 65536)).toThrow(/maximum page limit/);
  });

  it('returns a SharedArrayBuffer from getBuffer', () => {
    const mm = new MemoryManager({ initialPages: 16, maximumPages: 32 });
    expect(mm.getBuffer()).toBeInstanceOf(SharedArrayBuffer);
  });

  it.each([
    ['Int32', Int32Array],
    ['Float64', Float64Array],
    ['BigInt64', BigInt64Array],
    ['Uint8', Uint8Array],
  ] as const)('getView returns a %s view', (type, ctor) => {
    const mm = new MemoryManager({ initialPages: 16, maximumPages: 32 });
    const view = mm.getView(type, 0, 4);
    expect(view).toBeInstanceOf(ctor);
    expect(view.length).toBe(4);
  });

  it('throws on unsupported view types', () => {
    const mm = new MemoryManager({ initialPages: 16, maximumPages: 32 });
    expect(() => mm.getView('Float16' as any)).toThrow(/Unsupported view type/);
  });
});
