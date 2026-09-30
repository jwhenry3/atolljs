/**
 * Edge-branch coverage for redis.ts that needs no live server: the
 * ioRedisSubscriber normalization wrapper, the applyRemote size-mismatch and
 * malformed-message guards, the sync-interval auto-flush, custom key roots,
 * and the `?? {}` hgetall fallback. Same fake-Redis shape as
 * redisMemory.test.ts (Map-backed hash + in-process pub/sub).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  defineSharedMemory,
  field,
  setLogSink,
  type LogEntry,
} from '@atolljs/core';
import { ioRedisSubscriber, persistSharedMemory } from '../src/redis';

const makeMemory = () =>
  defineSharedMemory({ progress: field.number(), label: field.string({ maxBytes: 64 }) });

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
  const emit = (ch: string, msg: string) => listeners.get(ch)?.forEach((cb) => cb(ch, msg));
  return { client, subscriber, hashes, emit, listeners };
};

const captureLogs = () => {
  const entries: LogEntry[] = [];
  setLogSink((e) => entries.push(e));
  return { entries, restore: () => setLogSink(null) };
};

describe('ioRedisSubscriber', () => {
  it('normalizes the ioredis surface — subscribe, filtered messages, unsubscribe', () => {
    const client = {
      subscribe: vi.fn(() => 'subscribed'),
      unsubscribe: vi.fn(),
      on: vi.fn(),
    };
    const sub = ioRedisSubscriber(client);
    const onMessage = vi.fn();

    // subscribe() registers a 'message' filter and returns the client's result.
    expect(sub.subscribe('chan.a', onMessage)).toBe('subscribed');
    expect(client.subscribe).toHaveBeenCalledWith('chan.a');
    const handler = client.on.mock.calls.find((c) => c[0] === 'message')![1] as (
      c: string,
      m: string,
    ) => void;

    handler('chan.a', 'hit');
    handler('chan.other', 'miss'); // different channel — filtered out
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith('chan.a', 'hit');

    sub.unsubscribe?.('chan.a');
    expect(client.unsubscribe).toHaveBeenCalledWith('chan.a');
  });

  it('tolerates a client without unsubscribe', () => {
    const client = { subscribe: vi.fn(), on: vi.fn() };
    const sub = ioRedisSubscriber(client);
    expect(() => sub.unsubscribe?.('chan')).not.toThrow();
  });
});

describe('persistSharedMemory — replication guards', () => {
  it('skips remote fields whose byte length does not match the contract', async () => {
    const { entries, restore } = captureLogs();
    try {
      const redis = fakeRedis();
      const mem = bind(makeMemory());
      const p = persistSharedMemory(mem, {
        client: redis.client,
        name: 'guard',
        subscriber: redis.subscriber,
        instanceId: 'me',
      });
      await p.ready;

      // 'progress' reserves 8B — a 4-byte payload must be skipped, not applied.
      const bad = Buffer.from(new Uint8Array([1, 2, 3, 4])).toString('base64');
      redis.emit('atoll:mem:guard:ops', JSON.stringify({ src: 'other', path: 'progress', b64: bad }));

      expect(mem.progress.read()).toBe(0);
      expect(
        entries.some(
          (e) => e.scope === 'redis-mem' && e.level === 'warn' && /contract reserves/.test(e.message),
        ),
      ).toBe(true);
      await p.stop();
    } finally {
      restore();
    }
  });

  it('warns on malformed replication messages instead of throwing', async () => {
    const { entries, restore } = captureLogs();
    try {
      const redis = fakeRedis();
      const mem = bind(makeMemory());
      const p = persistSharedMemory(mem, {
        client: redis.client,
        name: 'bad',
        subscriber: redis.subscriber,
      });
      await p.ready;

      redis.emit('atoll:mem:bad:ops', 'this is { not json');
      await vi.waitFor(() =>
        expect(
          entries.some(
            (e) =>
              e.scope === 'redis-mem' && e.level === 'warn' && /malformed/.test(e.message),
          ),
        ).toBe(true),
      );
      await p.stop();
    } finally {
      restore();
    }
  });

  it('flushes dirty fields on the sync interval without a manual flush()', async () => {
    const redis = fakeRedis();
    const mem = bind(makeMemory());
    const p = persistSharedMemory(mem, {
      client: redis.client,
      name: 'poll',
      syncIntervalMs: 15,
    });
    await p.ready;

    mem.progress.write(77);
    // The interval timer — not flush() — must carry this write to Redis.
    await vi.waitFor(() =>
      expect(redis.hashes.get('atoll:mem:poll')?.has('progress')).toBe(true),
    );
    await p.stop();
  });

  it('logs and swallows a flush failure inside the sync interval', async () => {
    const { entries, restore } = captureLogs();
    try {
      let calls = 0;
      const client = {
        hset: vi.fn(async () => {
          if (++calls === 1) throw new Error('redis down');
        }),
        hgetall: async () => ({}),
      };
      const mem = bind(makeMemory());
      const p = persistSharedMemory(mem, { client, name: 'flaky', syncIntervalMs: 15 });
      await p.ready;

      mem.progress.write(1);
      // First interval flush fails → warn + carry on; a later tick succeeds.
      await vi.waitFor(() =>
        expect(
          entries.some(
            (e) => e.scope === 'redis-mem' && e.level === 'warn' && /flush failed/.test(e.message),
          ),
        ).toBe(true),
      );
      await p.stop();
    } finally {
      restore();
    }
  });

  it('ignores replication messages for fields the contract does not have', async () => {
    const redis = fakeRedis();
    const mem = bind(makeMemory());
    const p = persistSharedMemory(mem, {
      client: redis.client,
      name: 'unknown',
      subscriber: redis.subscriber,
      instanceId: 'me',
    });
    await p.ready;

    // 'nope' isn't a contract path — applyRemote returns without touching state.
    redis.emit(
      'atoll:mem:unknown:ops',
      JSON.stringify({ src: 'other', path: 'nope', b64: 'AAAA' }),
    );
    // Messages from our own instance id are echo-guarded away too.
    redis.emit(
      'atoll:mem:unknown:ops',
      JSON.stringify({ src: 'me', path: 'progress', b64: 'AAAAAAAAAAA=' }),
    );
    expect(mem.progress.read()).toBe(0);
    await p.stop();
  });

  it('uses the default key/name when neither is provided', async () => {
    const redis = fakeRedis();
    const mem = bind(makeMemory());
    const p = persistSharedMemory(mem, { client: redis.client });
    await p.ready;
    mem.progress.write(9);
    await p.stop(); // final flush persists under the default key
    expect(redis.hashes.get('atoll:mem:default')?.has('progress')).toBe(true);
  });

  it('stop() before the poll timer starts skips clearInterval', async () => {
    const redis = fakeRedis();
    const mem = bind(makeMemory());
    const p = persistSharedMemory(mem, { client: redis.client, name: 'early' });
    // No `await p.ready` — restore is still in flight, so `timer` is unset.
    const stopped = p.stop();
    await p.ready;
    await expect(stopped).resolves.toBeUndefined();
  });

  it('honors a custom key root and tolerates hgetall returning null', async () => {
    const client = {
      hset: vi.fn(async () => {}),
      hgetall: async () => null as unknown as Record<string, string>,
    };
    const mem = bind(makeMemory());
    const p = persistSharedMemory(mem, { client, key: 'custom:root', name: 'n' });
    await p.ready; // `?? {}` keeps a null hgetall from crashing restore.

    mem.progress.write(3);
    expect(await p.flush()).toBe(1);
    expect(client.hset).toHaveBeenCalledWith('custom:root:n', 'progress', expect.any(String));

    // stop() is idempotent — a second call returns early.
    await p.stop();
    await expect(p.stop()).resolves.toBeUndefined();
  });
});
