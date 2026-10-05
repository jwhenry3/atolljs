import type { SharedSpec } from '../contract/sharedMemory';
import type { WorkerDefinition } from '../worker/defineWorker';
import { connectWorker, type ConnectWorkerConfig, type WorkerClient } from './workerClient';

/**
 * Worker-shell side of a nested pool: identical options to
 * {@link ConnectWorkerConfig}, since the pool protocol (INIT / INIT_MEMORY /
 * EXECUTE_TASK) doesn't care which side of the thread boundary spawned the
 * workers. The distinguishing knob is `sharedBuffer` — inside a worker
 * shell, a bound contract's `.buffer` (or the shell pool's `sharedBuffer`)
 * lets sub-workers attach to the SAME shared memory instead of a fresh one.
 */
export interface ConnectSubWorkerConfig<S extends SharedSpec> extends ConnectWorkerConfig<S> {}

/**
 * Spawn a worker pool from INSIDE a worker — the worker-shell counterpart
 * of {@link connectWorker}. The sub-worker entry is a normal `defineWorker`
 * module; only the spawn site differs:
 *
 *   // shell.worker.ts — runs inside a dedicated worker
 *   const sub = connectSubWorker<SubWorker>({
 *     worker: () => new Worker(new URL('./sub.worker.ts', import.meta.url), { type: 'module' }),
 *     sharedMemory: memory,                    // fresh buffer per sub-pool
 *     // — or attach sub-workers to THIS worker's bound buffer:
 *     // sharedBuffer: memory.buffer,
 *     workers: 2,
 *   });
 *
 *   methods: { fanOut: (chunks) => Promise.all(chunks.map((c) => sub.crunch(c))) }
 *
 * Memory modes (both supported, pick per config):
 *  - `sharedMemory` without `sharedBuffer`: the sub-pool allocates its own
 *    WebAssembly.Memory inside the worker and binds the contract to it —
 *    a private buffer for this tier.
 *  - `sharedBuffer: someContract.buffer`: no allocation — every sub-worker
 *    binds the shell's existing buffer, so all three tiers (main, shell,
 *    sub) read and write the same fields. Hub-and-spoke sharing.
 *
 * Nested workers need `new Worker` inside a worker context: Chrome and
 * Firefox support it, Safari does not — feature-detect and fall back to
 * dispatching on the main-thread pool. Node's `worker_threads` nests
 * natively; use `worker: () => createNodeWorker(new Worker('./sub.js'))`
 * (a sub-worker entry still needs `@atolljs/node/shim` first).
 *
 * Bundlers detect `new Worker(new URL(...))` inside a worker bundle too:
 * the @atolljs/vite dev plugin rewrites nested entry URLs back onto its
 * `?worker_file` bundling path, and `vite build` emits nested worker
 * chunks. The same rules as the main thread apply — the URL must stay an
 * inline literal, never hoisted or computed.
 */
export function connectSubWorker<
  W extends WorkerDefinition,
  S extends SharedSpec = W extends WorkerDefinition<infer X> ? X : SharedSpec,
>(config: ConnectSubWorkerConfig<S>): WorkerClient<W, S> {
  const guarded: ConnectSubWorkerConfig<S> = { ...config };
  if (typeof config.worker !== 'function') {
    // A URL config means we call `new Worker` ourselves — surface a clear
    // error on engines without nested workers instead of a bare
    // ReferenceError at spawn time.
    guarded.worker = () => {
      if (typeof Worker === 'undefined') {
        throw new Error(
          'connectSubWorker: no `Worker` global in this context — nested dedicated workers are unsupported here (e.g. Safari). Feature-detect and fall back to a main-thread pool.',
        );
      }
      return new Worker(config.worker as URL, { type: 'module' });
    };
  }
  return connectWorker<W, S>(guarded);
}
