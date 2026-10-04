/**
 * Worker-shell fixture for the nested-pool functional test: a real atoll
 * WorkerPool running INSIDE a node:worker_threads worker. Receives the main
 * pool's protocol messages on parentPort, and fans 'shell-fanout' /
 * 'shell-bump' out to a nested pool of nestedSub.worker.mjs workers.
 *
 * The nested pool is created lazily on first use so the INIT_MEMORY buffer
 * from the main pool has already landed — that buffer is handed down via
 * `sharedBuffer`, so all three tiers (main → shell → sub) share one counter.
 *
 * The EventEmitter→EventTarget adapter is inlined: packages/node's
 * createNodeWorker lives in non-erasable TS (parameter properties) which
 * plain Node can't type-strip — see aliasCore.mjs. '@atolljs/core' resolves
 * via the test's --import aliasCore.mjs hook to the built dist bundle.
 */
import { parentPort, threadId, Worker as NodeWorker } from 'node:worker_threads';
import { WorkerPool } from '@atolljs/core';

const adapt = (w) => ({
  postMessage: (m) => w.postMessage(m),
  terminate: () => void w.terminate(),
  addEventListener: (type, handler) => {
    if (type === 'message') w.on('message', (data) => handler({ data }));
    else w.on('error', (error) => handler({ type: 'error', message: error.message, error }));
  },
  removeEventListener: (type, handler) => {
    if (type === 'message') w.off('message', handler);
    else w.off('error', handler);
  },
});

let buffer;
let subPool;
const getSubPool = () =>
  (subPool ??= new WorkerPool({
    createWorker: () => adapt(new NodeWorker(new URL('./nestedSub.worker.mjs', import.meta.url))),
    sharedBuffer: buffer,
    poolSize: 2,
  }));

const handlers = {
  /** The shell worker's own thread — the middle tier. */
  'shell-thread': () => threadId,

  /** Fan out to a sub-worker: returns { shell, sub } thread ids. */
  'shell-fanout': async () => ({
    shell: threadId,
    sub: await getSubPool().runTask({ taskId: 'sub-thread' }),
  }),

  /** Route a counter bump into the sub-pool — writes the shared buffer. */
  'shell-bump': (args) => getSubPool().runTask({ taskId: 'sub-bump' }, ...(args ?? [])),
};

parentPort.on('message', async (msg) => {
  if (msg.type === 'INIT_MEMORY') {
    buffer = msg.memory?.buffer ?? msg.buffer;
    return;
  }
  if (msg.type === 'INIT' || msg.type !== 'EXECUTE_TASK') return;
  try {
    const result = await handlers[msg.taskId]?.(msg.args ?? []);
    parentPort.postMessage({ messageId: msg.messageId, success: true, result });
  } catch (err) {
    parentPort.postMessage({ messageId: msg.messageId, success: false, error: err?.message ?? String(err) });
  }
});
