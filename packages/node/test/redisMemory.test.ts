/**
 * Redis memory adapter — flush, restore, and cross-instance replication.
 * The fake client is a Map-backed hash + in-process pub/sub bus: same shape
 * as ioredis/node-redis (hset/hgetall on base64 strings, subscribe(cb)).
 */
import { describe, expect, it } from 'vitest';
import { defineSharedMemory, field, mz } from '@atolljs/core';
import { persistSharedMemory, redisMemoryAdapter } from '../src/redis';

const makeMemory = () =>
  defineSharedMemory({
    progress: field.number(),
    label: field.string({ maxBytes: 64 }),
    counts: field.int32Array({ length: 4 }),
    rows: field.list({
      schema: mz.object({ id: mz.u32(), open: mz.boolean() }),
      count: 8,
    }),
  });

const bind = (memory: ReturnType<typeof makeMemory>) => {
  memory.bind(new SharedArrayBuffer(memory.totalBytes));
  return memory;
};

const fakeRedis = () => {
  const hashes = new Map<string, Map<string, string>>();
  const listeners = new Map<string, Set<(ch: string, m: string) => void>>();
  const client = {
    hset: async (key: string, f: string, v: string) => {
      let h = hashes.get(key);
      if (!h) hashes.set(key, (h = new Map()));
      h.set(f, v);
    },
    hgetall: async (key: string) => Object.fromEntries(hashes.get(key) ?? new Map()),
    publish: async (ch: string, msg: string) => {
      listeners.get(ch)?.forEach((cb) => cb(ch, msg));
    },
  };
  const subscriber = {
    subscribe: (ch: string, cb: (ch: string, m: string) => void) => {
      let set = listeners.get(ch);
      if (!set) listeners.set(ch, (set = new Set()));
      set.add(cb);
    },
    unsubscribe: (ch: string) => listeners.delete(ch),
  };
  return { client, subscriber, hashes };
};

describe('persistSharedMemory', () => {
  it('flushes fields whose version counter moved', async () => {
    const redis = fakeRedis();
    const mem = bind(makeMemory());
    const p = persistSharedMemory(mem, { client: redis.client, name: 't' });
    await p.ready;

    mem.progress.write(42);
    mem.label.write('queue a');
    mem.counts.write(new Int32Array([1, 2, 3, 4]));

    expect(await p.flush()).toBe(3);
    const hash = redis.hashes.get('atoll:mem:t')!;
    expect(hash.has('progress')).toBe(true);
    expect(hash.has('label')).toBe(true);
    expect(hash.has('counts')).toBe(true);

    // Clean — nothing new to write.
    expect(await p.flush()).toBe(0);
    await p.stop();
  });

  it('restores hash state into a freshly bound buffer', async () => {
    const redis = fakeRedis();
    const a = bind(makeMemory());
    const pa = persistSharedMemory(a, { client: redis.client, name: 't' });
    await pa.ready;
    a.progress.write(7);
    a.label.write('restored');
    a.counts.write(new Int32Array([9, 8, 7, 6]));
    a.rows.writeAt(0, { id: 11, open: true });
    a.rows.commit();
    await pa.flush();
    await pa.stop();

    // A "second process": same spec, fresh buffer, same key.
    const b = bind(makeMemory());
    const pb = persistSharedMemory(b, { client: redis.client, name: 't' });
    await pb.ready;
    await pb.stop();

    expect(b.progress.read()).toBe(7);
    expect(b.label.read()).toBe('restored');
    expect(Array.from(b.counts.read())).toEqual([9, 8, 7, 6]);
    expect(b.rows.readAt(0)).toEqual({ id: 11, open: true });
  });

  it('replicates writes between two instances and never echoes', async () => {
    const redis = fakeRedis();
    const a = bind(makeMemory());
    const b = bind(makeMemory());
    const pa = persistSharedMemory(a, {
      client: redis.client, name: 'r',
      subscriber: redis.subscriber, instanceId: 'a',
    });
    const pb = persistSharedMemory(b, {
      client: redis.client, name: 'r',
      subscriber: redis.subscriber, instanceId: 'b',
    });
    await Promise.all([pa.ready, pb.ready]);

    a.progress.write(99);
    expect(await pa.flush()).toBe(1);
    // The publish applied straight into B's buffer + bumped its version.
    expect(b.progress.read()).toBe(99);
    // No echo — the applied write is already accounted in B's diff.
    expect(await pb.flush()).toBe(0);

    await Promise.all([pa.stop(), pb.stop()]);
  });

  it('restricts persistence to the fields subset', async () => {
    const redis = fakeRedis();
    const mem = bind(makeMemory());
    const p = persistSharedMemory(mem, {
      client: redis.client,
      name: 'subset',
      fields: ['progress'],
    });
    await p.ready;
    mem.progress.write(1);
    mem.label.write('not persisted');
    expect(await p.flush()).toBe(1);
    const hash = redis.hashes.get('atoll:mem:subset')!;
    expect([...hash.keys()]).toEqual(['progress']);
    await p.stop();
  });

  it('stop() performs a final flush', async () => {
    const redis = fakeRedis();
    const mem = bind(makeMemory());
    const p = persistSharedMemory(mem, { client: redis.client, name: 'final' });
    await p.ready;
    mem.progress.write(5);
    await p.stop();
    const hash = redis.hashes.get('atoll:mem:final')!;
    expect(hash.has('progress')).toBe(true);
  });

  it('redisMemoryAdapter produces the pool-config factory shape', async () => {
    const redis = fakeRedis();
    const adapter = redisMemoryAdapter(redis.client, { name: 'factory' });
    const mem = bind(makeMemory());
    const p = adapter(mem);
    expect(p).toBeTruthy();
    await p!.ready;
    mem.progress.write(3);
    expect(await p!.flush()).toBe(1);
    await p!.stop();
  });
});
