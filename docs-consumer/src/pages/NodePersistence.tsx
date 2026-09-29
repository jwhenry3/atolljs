import { CodeBlock } from '../components/CodeBlock';

const POOL = `// persistence as a pool option — attaches after bind, stops on terminate()
import { createNodePool } from '@atolljs/node';
import { redisMemoryAdapter, ioRedisSubscriber } from '@atolljs/node/redis';
import { incidentsMemory } from './incidents.contract';

const pool = createNodePool({
  worker: () => new Worker(new URL('./incidents.worker.ts', import.meta.url)),
  sharedMemory: incidentsMemory,
  persistence: redisMemoryAdapter(redis, {
    name: 'incidents',       // hash: atoll:mem:incidents
    syncIntervalMs: 100,
    subscriber: ioRedisSubscriber(redis.duplicate()), // optional replication
  }),
});
await pool.persistence?.ready; // state restored into the buffer`;

const CLIENT = `// the client surface — ioredis and node-redis both satisfy it
interface RedisHashClient {
  hset(key: string, field: string, value: string): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string>>;
  publish?(channel: string, message: string): Promise<unknown>; // replication only
}
// values are base64 strings — any client works, no Buffer mode needed`;

export function NodePersistence() {
  return (
    <article>
      <h1>Node.js — memory persistence</h1>
      <p className="lead">
        <code>@atolljs/node/redis</code> persists a shared-memory
        contract&apos;s field regions to Redis — restart durability out of
        the box, and cross-process replication when a{' '}
        <code>subscriber</code> is attached. The SharedArrayBuffer stays the
        synchronous source of truth; Redis mirrors it behind the scenes.
      </p>

      <h2>Wiring</h2>
      <CodeBlock code={POOL} file="src/incidents.ts" />
      <p>
        <code>persistence</code> is a factory the pool invokes right after
        the contract binds — <code>redisMemoryAdapter(client, opts)</code>{' '}
        produces one. Or attach standalone with{' '}
        <code>persistSharedMemory(memory, opts)</code> anywhere a bound
        contract exists (e.g. an Express bootstrap that shares the buffer).
      </p>

      <h2>What lands in Redis</h2>
      <ul>
        <li><code>atoll:mem:&lt;name&gt;</code> — a hash; member = field path (<code>state.metrics</code>), value = base64 of the field&apos;s byte region.</li>
        <li><code>atoll:mem:&lt;name&gt;:ops</code> — the pub/sub channel; each dirty field publishes <code>{'{ src, path, b64 }'}</code>.</li>
        <li>The version-counter block is <em>not</em> persisted — per-process coordination, not state.</li>
      </ul>

      <h2>Client surface</h2>
      <p>
        Three hash commands plus optional <code>publish</code> — deliberately
        narrow so any Redis client qualifies:
      </p>
      <CodeBlock code={CLIENT} language="typescript" />
      <p>
        For replication pass a <code>subscriber</code>: node-redis&apos;s{' '}
        <code>subscribe(channel, listener)</code> already matches; wrap an
        ioredis connection with <code>ioRedisSubscriber(client)</code>.
      </p>

      <h2>Caveats</h2>
      <ul>
        <li>Restore is async — <code>await persistence.ready</code> (or <code>pool.persistence?.ready</code>) before serving traffic that depends on restored state.</li>
        <li>List <code>writeAt</code> only becomes visible to the flush loop after <code>commit()</code> — same rule as observers.</li>
        <li>Replication is last-write-wins per field — coordination, not consensus.</li>
        <li>One process&apos;s adapter instance does the flushing — workers write to the shared buffer, the main thread&apos;s adapter sees the version bumps.</li>
      </ul>
      <p>
        NestJS usage — including injecting the client via{' '}
        <code>registerPoolAsync</code> — is under{' '}
        <a href="#/fw-nestjs/persistence">NestJS → Persistence</a>.
      </p>
    </article>
  );
}
