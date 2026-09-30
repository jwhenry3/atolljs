// Hand an existing shared buffer to workers that aren't bound through a
// pool's INIT_MEMORY handshake — e.g. a second, message-only pool of HTTP
// workers that should read another pool's contract buffer. A pool's
// sharedMemory config creates a NEW WebAssembly.Memory, so sharing requires
// passing the buffer explicitly; this module packages both halves.
//
//   // main — wraps a worker factory; bundler detection still sees the
//   // literal `new Worker(new URL(...))` inside the thunk:
//   worker: withSharedBuffer(
//     () => new Worker(new URL('./housed.worker.ts', import.meta.url)),
//     () => getAtollPool('incidents')?.sharedBuffer,   // per spawn — respawns included
//   ),
//
//   // worker entry — resolves once the buffer lands, binds all contracts:
//   await bindSharedBuffer();
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import type { Worker as NodeWorker } from 'node:worker_threads';
import { bindSharedMemories } from '@atolljs/core';

/** Wire id for the share-buffer message — distinct from pool protocol types. */
const SHARED_BUFFER = 'SHARED_BUFFER';

/**
 * Main thread: wraps a worker factory so each spawned worker receives a
 * shared buffer over its message channel. The buffer may be a thunk —
 * evaluated per spawn, so respawned workers get it too. An unresolved
 * buffer still posts (empty), so the worker fails loudly instead of hanging.
 */
export function withSharedBuffer<W extends Worker | NodeWorker>(
  spawn: () => W,
  buffer: SharedArrayBuffer | (() => SharedArrayBuffer | undefined),
): () => W {
  return () => {
    const worker = spawn();
    const shared = typeof buffer === 'function' ? buffer() : buffer;
    // Messages posted before the worker subscribes are queued by Node —
    // the listener in bindSharedBuffer sees it as soon as the entry runs.
    worker.postMessage({ type: SHARED_BUFFER, buffer: shared });
    return worker;
  };
}

/**
 * Worker side: resolve this worker's shared buffer and bind every defined
 * contract to it (the same call the worker bootstrap makes on INIT_MEMORY).
 * Checks `workerData.buffer` first — the manual channel — then waits for the
 * message {@link withSharedBuffer} posts. Rejects on an empty buffer or after
 * `timeoutMs` so misconfigurations surface instead of hanging.
 */
export function bindSharedBuffer(timeoutMs = 10_000): Promise<SharedArrayBuffer> {
  const fromWorkerData = (workerData as { buffer?: SharedArrayBuffer } | null)?.buffer;
  if (fromWorkerData) {
    bindSharedMemories(fromWorkerData);
    return Promise.resolve(fromWorkerData);
  }
  if (isMainThread || !parentPort) {
    return Promise.reject(new Error('bindSharedBuffer() must be called inside a worker'));
  }
  const port = parentPort;
  return new Promise((resolve, reject) => {
    const onMessage = (msg: { type?: string; buffer?: SharedArrayBuffer }) => {
      if (msg?.type !== SHARED_BUFFER) return;
      clearTimeout(timer);
      port.off('message', onMessage);
      if (!msg.buffer) {
        reject(new Error('bindSharedBuffer(): the producing side sent an empty buffer'));
        return;
      }
      bindSharedMemories(msg.buffer);
      resolve(msg.buffer);
    };
    const timer = setTimeout(() => {
      // Detach — a late SHARED_BUFFER must not bind after the rejection.
      port.off('message', onMessage);
      reject(new Error(`bindSharedBuffer(): no shared buffer arrived within ${timeoutMs}ms`));
    }, timeoutMs);
    port.on('message', onMessage);
  });
}
