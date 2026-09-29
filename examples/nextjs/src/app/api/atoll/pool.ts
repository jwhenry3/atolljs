import { Worker } from 'node:worker_threads';
import { createNodePool, createNodeWorker } from '@atolljs/node';
import { digestMemory, HashDigest } from './digest.contract';

const create = () => {
  const pool = createNodePool({
    sharedMemory: digestMemory,
    poolSize: 2,
    tasks: { hash: HashDigest },
    createWorker: () =>
      createNodeWorker(
        // Env-var escape hatch so vitest can inject the protocol fixture worker
        // (test/apiAtoll.test.ts) — webpack worker detection covers the default
        // branch when bundling, per docs/frameworks/nextjs.md.
        process.env.ATOLL_DIGEST_WORKER
          ? new Worker(process.env.ATOLL_DIGEST_WORKER)
          : new Worker(new URL('./atoll.worker.ts', import.meta.url)),
      ),
  });
  // Return the memory handle the POOL bound. Next compiles the route graph
  // separately from modules imported via instrumentation, so `import
  // { digestMemory }` here and in a route can be two contract instances —
  // only the pool's copy is bound on this thread.
  return { pool, memory: digestMemory };
};

// Module scope = process scope in a Node route handler. Stashing on
// globalThis survives dev-mode HMR module reloads AND dedupes the
// module-graph instances Next creates per route layer.
export const getDigest = (): ReturnType<typeof create> => {
  const g = globalThis as { __atollDigest?: ReturnType<typeof create> };
  return (g.__atollDigest ??= create());
};
