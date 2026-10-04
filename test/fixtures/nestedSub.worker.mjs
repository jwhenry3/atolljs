/**
 * Leaf worker for the nested-pool functional test: a plain-JS atoll
 * protocol worker (same convention as atollProtocol.worker.mjs). Stores the
 * INIT_MEMORY buffer — whether it arrives as `memory` (Wasm.Memory) or a
 * raw `buffer` (injected sharedBuffer) — and bumps the f64 counter at
 * offset 0, which the contract's first `field.number()` occupies.
 */
import { parentPort, threadId } from 'node:worker_threads';

let numbers;

const handlers = {
  /** Proves the task ran on a THIRD thread — not main, not the shell worker. */
  'sub-thread': () => threadId,

  /** Shared-memory write: bumps the counter field by args[0] ?? 1. */
  'sub-bump': ([by]) => {
    numbers[0] += by ?? 1;
    return numbers[0];
  },
};

parentPort.on('message', async (msg) => {
  if (msg.type === 'INIT_MEMORY') {
    numbers = new Float64Array(msg.memory?.buffer ?? msg.buffer);
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
