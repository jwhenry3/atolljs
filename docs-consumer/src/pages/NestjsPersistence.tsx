import { CodeBlock } from '../components/CodeBlock';

const REGISTER = `// shared-memory persistence — the Redis adapter as a pool option
import { AtollModule } from '@atolljs/nestjs';
import { redisMemoryAdapter, ioRedisSubscriber } from '@atolljs/node/redis';
import { incidentsMemory } from './incidents.contract';

// Static client in scope:
AtollModule.registerPool({
  name: 'incidents',
  worker: () => new Worker(new URL('./incidents.worker.ts', import.meta.url)),
  sharedMemory: incidentsMemory,
  persistence: redisMemoryAdapter(redis),
});

// Or inject the client — registerPoolAsync:
AtollModule.registerPoolAsync({
  name: 'incidents',
  useFactory: (redis: Redis) => ({
    worker: () => new Worker(new URL('./incidents.worker.ts', import.meta.url)),
    sharedMemory: incidentsMemory,
    persistence: redisMemoryAdapter(redis, {
      name: 'incidents',                       // hash key atoll:mem:incidents
      syncIntervalMs: 100,                     // version-diff poll cadence
      // Cross-process replication — a SECOND connection (pub/sub needs its own):
      subscriber: ioRedisSubscriber(redis.duplicate()),
      // fields: ['state.metrics', 'signals.seedProgress'],   // persist a subset
    }),
  }),
  inject: ['REDIS'],
});`;

const STANDALONE = `// attach by hand anywhere a bound contract exists — the pool
// keeps it alive (attach) and stops it (terminate → final flush)
import { persistSharedMemory } from '@atolljs/node/redis';

const persistence = persistSharedMemory(incidentsMemory, {
  client: redis,          // hset/hgetall/publish on base64 strings
  name: 'incidents',
  subscriber: ioRedisSubscriber(redis.duplicate()),
});
await persistence.ready;  // initial HGETALL restored into the buffer`;

export function NestjsPersistence() {
  return (
    <article>
      <h1>NestJS — memory persistence</h1>
      <p className="lead">
        The shared-memory analog of NestJS&apos;s Redis WebSocket adapter:
        field regions mirror to a Redis hash so contract state survives
        restarts — and optionally replicate across processes over a pub/sub
        channel, so two app instances see each other&apos;s writes.
      </p>

      <h2>Wiring</h2>
      <p>
        The pool config&apos;s <code>persistence</code> option takes the
        adapter factory — the pool invokes it right after binding the
        contract and calls its <code>stop()</code> inside{' '}
        <code>pool.terminate()</code> (which <code>AtollModule</code> already
        runs on module destroy — the final flush lands there).
      </p>
      <CodeBlock code={REGISTER} file="app.module.ts" />
      <CodeBlock code={STANDALONE} file="main.ts" />

      <h2>How it works</h2>
      <ul>
        <li><strong>The buffer stays the source of truth.</strong> <code>read()</code>/<code>write()</code> remain synchronous memory ops — Redis sits behind the contract, never in front of it.</li>
        <li><strong>Per-field hash members</strong> — <code>atoll:mem:&lt;name&gt;</code> holds <code>path → base64 bytes</code> for every field region (or the <code>fields</code> subset).</li>
        <li><strong>Version-diff flush</strong> — every connector write already bumps an Atomics counter; the adapter polls those counters on <code>syncIntervalMs</code> and <code>hset</code>s only what moved. No instrumentation of the hot path.</li>
        <li><strong>Restore on attach</strong> — <code>ready</code> resolves after the initial <code>hgetall</code> writes bytes back into the buffer and bumps local versions, so <code>observe()</code> watchers fire as if the writes were local.</li>
      </ul>

      <h2>Replication across instances</h2>
      <p>
        With <code>subscriber</code> set, each flush also publishes{' '}
        <code>{'{ src, path, b64 }'}</code> to{' '}
        <code>atoll:mem:&lt;name&gt;:ops</code>. Subscribers write the bytes
        into their own buffer and bump the local version counter — same wake
        semantics as a local write. An instance id guards echoes (an applied
        remote write doesn&apos;t re-publish). Semantics are{' '}
        <strong>last-write-wins per field</strong> — Redis is coordination,
        not consensus; it suits dashboards/progress/read-models, not
        transactional state.
      </p>

      <h2>Caveats</h2>
      <ul>
        <li>List fields only flush after <code>commit()</code> — writes are detected via the version counter, same as observers.</li>
        <li><code>ready</code> races early worker binds: workers that bound before restore see zeros, then the version bumps land. Await <code>ready</code> before serving traffic that depends on restored state.</li>
        <li>Pub/sub needs a dedicated connection — <code>ioRedisSubscriber(redis.duplicate())</code> for ioredis; node-redis&apos;s <code>subscribe(ch, cb)</code> shape fits <code>RedisSubscriber</code> directly.</li>
      </ul>
      <p>
        The adapter itself is framework-free —{' '}
        <a href="#/fw-node/persistence">Node.js → Persistence</a> covers{' '}
        <code>createNodePool</code> usage and the client interface.
      </p>
    </article>
  );
}
