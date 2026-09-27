/**
 * Real node:worker_threads fixture implementing the mesh wire protocol in
 * plain JS — INIT_MEMORY captures the shared buffer, EXECUTE_TASK runs a
 * small built-in task set and replies { messageId, success, result|error }.
 * Used by functional tests that spawn a genuine worker thread (no bundler
 * available to compile the TS worker entries under vitest).
 *
 * Field layout is contract-derived: the pool's SharedMemory places the first
 * declared field at byteOffset 0, so `new Float64Array(buffer)[0]` is the
 * `field.number()` counter.
 */
import { createHash } from 'node:crypto';
import { parentPort, threadId } from 'node:worker_threads';

let numbers;

const handlers = {
  /** Returns args[0] — proves the dispatch round-trip. */
  't-echo': ([value]) => value,

  /** Shared-memory write on the worker side: bumps counter by args[0] ?? 1. */
  't-bump': ([by]) => {
    numbers[0] += by ?? 1;
    return numbers[0];
  },

  /** Proves the task ran off the main thread. */
  't-thread': () => threadId,

  /** Mirrors the Next.js digest contract ('digest.hash' task). */
  'digest.hash': ([input = 'incident-feed', rounds = 50_000]) => {
    const t0 = performance.now();
    let digest = input;
    for (let i = 0; i < rounds; i++) {
      digest = createHash('sha256').update(digest).digest('hex');
    }
    numbers[0] += 1;
    return { hash: digest.slice(0, 16), rounds, ms: performance.now() - t0, jobsDone: numbers[0] };
  },

  't-fail': () => {
    throw new Error('fixture worker exploded');
  },
};

parentPort.on('message', async (msg) => {
  if (msg.type === 'INIT_MEMORY') {
    numbers = new Float64Array(msg.memory.buffer);
    return;
  }
  if (msg.type === 'EXECUTE_TASK') {
    try {
      const handler = handlers[msg.taskId];
      if (!handler) throw new Error(`Task handler not found for id: ${msg.taskId}`);
      const result = await handler(msg.args ?? []);
      parentPort.postMessage({ messageId: msg.messageId, success: true, result });
    } catch (err) {
      parentPort.postMessage({ messageId: msg.messageId, success: false, error: err.message });
    }
  }
});
