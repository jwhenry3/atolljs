/**
 * Redis persistence for shared-memory contracts — the shared-memory analog
 * of NestJS's Redis WebSocket adapter. The SharedArrayBuffer stays the
 * synchronous source of truth on this thread (the contract's read/write
 * surface can't be async); the adapter mirrors field regions to a Redis hash
 * so state survives restarts, and optionally replicates writes across
 * processes through a pub/sub channel.
 *
 * Layout in Redis:
 *   {key}:{name}              hash — member = field path, value = base64 bytes
 *   {key}:{name}:ops          channel — { src, path, b64 } per dirty field
 *
 * Change detection is the version-counter block every write already bumps
 * (Atomics), polled on `syncIntervalMs` — no instrumentation of the hot
 * write path. Remote applies bump the local version too, so `observe()`/
 * waitAsync watchers fire exactly as they do for local writes.
 *
 * The client surface is intentionally minimal (base64 strings, hset/hgetall)
 * — ioredis and node-redis both satisfy it directly; `publish` is only used
 * when replication is enabled.
 */
import { scoped, type SharedMemory, type SharedSpec } from '@atolljs/core';

const log = scoped('redis-mem');

/** The hash commands the adapter needs — ioredis and node-redis both fit. */
export interface RedisHashClient {
  hset(key: string, field: string, value: string): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string>>;
  publish?(channel: string, message: string): Promise<unknown>;
}

/**
 * Normalized pub/sub surface — node-redis's `client.subscribe(ch, listener)`
 * matches directly; wrap an ioredis connection with `ioRedisSubscriber`.
 */
export interface RedisSubscriber {
  subscribe(
    channel: string,
    onMessage: (channel: string, message: string) => void,
  ): unknown;
  unsubscribe?(channel: string): unknown;
}

/** Wrap an ioredis connection in the normalized subscriber surface. */
export const ioRedisSubscriber = (client: {
  subscribe(channel: string): unknown;
  unsubscribe?(channel: string): unknown;
  on(event: 'message', cb: (channel: string, message: string) => void): unknown;
}): RedisSubscriber => ({
  subscribe: (channel, onMessage) => {
    client.on('message', (c, m) => {
      if (c === channel) onMessage(c, m);
    });
    return client.subscribe(channel);
  },
  unsubscribe: (channel) => client.unsubscribe?.(channel),
});

export interface RedisMemoryAdapterOptions {
  client: RedisHashClient;
  /** Hash key root — the contract lives at `${key}:${name}`. Default 'atoll:mem'. */
  key?: string;
  /** Contract namespace under the key root. Default 'default'. */
  name?: string;
  /** Version-diff poll cadence — dirty fields flush at most this often. Default 100ms. */
  syncIntervalMs?: number;
  /** Restrict persistence to a subset of field paths. */
  fields?: string[];
  /**
   * A second Redis connection subscribed to `${key}:${name}:ops` — enables
   * cross-process replication. Each instance publishes its dirty fields;
   * subscribers apply the bytes into their own buffer and bump the local
   * version counter so local observers fire. Last write wins per field.
   */
  subscriber?: RedisSubscriber;
  /** Echo guard — defaults to pid + random. Override for deterministic tests. */
  instanceId?: string;
}

export interface RedisMemoryPersistence {
  /** Resolves when initial restore + subscriber attach complete. */
  readonly ready: Promise<void>;
  /** Flush dirty fields now — also runs automatically on the poll interval. */
  flush(): Promise<number>;
  /** Final flush, unsubscribe, and stop the poll timer. */
  stop(): Promise<void>;
}

interface FieldRegion {
  path: string;
  byteOffset: number;
  byteLength: number;
  version?: { view: Int32Array; index: number };
}

/**
 * Attach Redis persistence to a bound (or soon-bound) shared-memory contract.
 * `ready` resolves once state has been restored INTO the local buffer —
 * workers that bind afterwards see the restored state, and version bumps
 * wake observers on this thread.
 */
export function persistSharedMemory<S extends SharedSpec>(
  memory: SharedMemory<S>,
  options: RedisMemoryAdapterOptions,
): RedisMemoryPersistence {
  const { client, subscriber } = options;
  const key = `${options.key ?? 'atoll:mem'}:${options.name ?? 'default'}`;
  const channel = `${key}:ops`;
  const intervalMs = options.syncIntervalMs ?? 100;
  const instanceId =
    options.instanceId ?? `${process.pid}:${Math.random().toString(36).slice(2, 8)}`;

  let buffer: SharedArrayBuffer;
  let regions: FieldRegion[] = [];
  const lastSeen = new Map<string, number>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  let flushing = Promise.resolve(0);

  const b64encode = (u8: Uint8Array): string =>
    Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');
  const b64decode = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'base64'));

  const fieldRegion = (path: string): FieldRegion | undefined =>
    regions.find((r) => r.path === path);

  /**
   * Write bytes into the field's region and bump its local version counter —
   * the same signal a connector write produces, so waitAsync observers and
   * our own diff both see it. Marks lastSeen so the flush doesn't echo the
   * applied value straight back to Redis (no publish ping-pong).
   */
  const applyRemote = (path: string, b64: string): void => {
    const region = fieldRegion(path);
    if (!region) return;
    const bytes = b64decode(b64);
    if (bytes.byteLength !== region.byteLength) {
      log.warn(`"${path}": remote field is ${bytes.byteLength}B but the contract reserves ${region.byteLength}B — skipped`);
      return;
    }
    new Uint8Array(buffer, region.byteOffset, region.byteLength).set(bytes);
    if (region.version) {
      Atomics.add(region.version.view, region.version.index, 1);
      Atomics.notify(region.version.view, region.version.index);
      lastSeen.set(path, Atomics.load(region.version.view, region.version.index));
    }
  };

  /** Flush fields whose version counter moved since the last flush. */
  const flush = async (): Promise<number> => {
    if (stopped) return 0;
    let dirty = 0;
    for (const region of regions) {
      const current = region.version
        ? Atomics.load(region.version.view, region.version.index)
        : 0;
      if (lastSeen.get(region.path) === current) continue;
      lastSeen.set(region.path, current);
      dirty++;
      const b64 = b64encode(new Uint8Array(buffer, region.byteOffset, region.byteLength));
      await client.hset(key, region.path, b64);
      if (subscriber) {
        await client.publish?.(
          channel,
          JSON.stringify({ src: instanceId, path: region.path, b64 }),
        );
      }
    }
    return dirty;
  };

  const restore = async (): Promise<void> => {
    const all = (await client.hgetall(key)) ?? {};
    let restored = 0;
    for (const [path, b64] of Object.entries(all)) {
      applyRemote(path, b64);
      restored++;
    }
    if (restored) log.info(`restored ${restored} field(s) from ${key}`);
  };

  const ready = new Promise<void>((resolve, reject) => {
    memory.onBound(() => {
      buffer = memory.buffer;
      regions = memory
        .fields()
        .filter((f) => !options.fields || options.fields.includes(f.path))
        .map((f) => ({ ...f, version: memory.connector(f.path)._version }));
      for (const r of regions) {
        if (r.version) {
          lastSeen.set(r.path, Atomics.load(r.version.view, r.version.index));
        }
      }
      (async () => {
        await restore();
        if (subscriber) {
          await subscriber.subscribe(channel, (_ch, message) => {
            try {
              const msg = JSON.parse(message) as { src?: string; path?: string; b64?: string };
              if (msg.src === instanceId || !msg.path || !msg.b64) return;
              applyRemote(msg.path, msg.b64);
            } catch (e) {
              log.warn('malformed replication message', e);
            }
          });
        }
        // stop() may have run before ready resolved — don't start a poll
        // loop that nothing will ever clear.
        if (stopped) return;
        timer = setInterval(() => {
          flushing = flushing.then(flush).catch((e) => {
            log.warn('flush failed', e);
            return 0;
          });
        }, intervalMs);
        timer.unref?.();
      })().then(resolve, reject);
    });
  });

  return {
    ready,
    // Serialize manual flushes behind the interval's — concurrent hset on
    // the same members is pointless churn.
    flush: () => (flushing = flushing.then(flush).catch(() => 0)),
    stop: async () => {
      if (stopped) return;
      stopped = true;
      if (timer) clearInterval(timer);
      await subscriber?.unsubscribe?.(channel);
      await flushing.catch(() => 0);
      // One last flush — durability on shutdown — bypass the stopped guard.
      // A Redis outage here must not reject stop(): teardown is done either
      // way, the flush is best-effort persistence.
      stopped = false;
      try {
        await flush();
      } catch (e) {
        log.warn('final flush failed', e);
      } finally {
        stopped = true;
      }
    },
  };
}

/**
 * Pool-config form — the `persistence` option shape for `createNodePool` /
 * `AtollModule.registerPool`. Nest's `app.useWebSocketAdapter()` analog:
 *
 *   persistence: redisMemoryAdapter(redis, { name: 'incidents' })
 */
export function redisMemoryAdapter(
  client: RedisHashClient,
  options: Omit<RedisMemoryAdapterOptions, 'client'> = {},
): (memory: SharedMemory) => RedisMemoryPersistence {
  return (memory) => persistSharedMemory(memory, { ...options, client });
}
