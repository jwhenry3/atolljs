import { TaskRegistry } from './registry';
import { bindSharedMemories, getDefinedSharedMemoryCount } from '../contract/sharedMemory';
import { fmtBytes, scoped } from '../log';

const workerLog = scoped('worker');

let memoryInitialized = false;
let wired = false;

/**
 * Wire `self.onmessage` to the pool protocol (INIT / INIT_MEMORY /
 * EXECUTE_TASK). Runs automatically on import for the public
 * `import '@atolljs/core/worker/workerBootstrap'` entry, and is also called
 * from `defineWorker()` — an explicit call survives bundler tree-shaking,
 * unlike a bare side-effect import whose `sideEffects` glob can miss
 * renamed dist chunks. Idempotent: safe on repeated defineWorker() calls.
 */
export function installWorkerListener(): void {
  if (wired) return;
  if (typeof self === 'undefined') {
    // Imported outside a worker context (e.g. a Nest entry that shares the
    // atoll-nestjs barrel with the worker entry) — nothing to wire.
    workerLog.warn('workerBootstrap: no worker global found — skipping message wiring');
    return;
  }
  wired = true;

  self.onmessage = async (event) => {
    const data = event.data;

    if (data.type === 'INIT') {
      memoryInitialized = true;
      if (getDefinedSharedMemoryCount() > 0) {
        workerLog.warn(
          'pool sent INIT without memory, but shared-memory contracts are defined — field access will throw until bound',
        );
      }
      workerLog.info('initialized (message-only pool — no shared memory)');
      return;
    }

    if (data.type === 'INIT_MEMORY') {
      const memory = data.memory as WebAssembly.Memory;
      bindSharedMemories(memory.buffer as unknown as SharedArrayBuffer);
      memoryInitialized = true;
      workerLog.info(`shared memory initialized (${fmtBytes(memory.buffer.byteLength)})`);
      return;
    }

    if (data.type === 'EXECUTE_TASK') {
      const { messageId, taskId, args } = data;

      if (!memoryInitialized) {
        workerLog.warn(`rejected ${taskId} — shared memory not initialized`);
        self.postMessage({ messageId, success: false, error: 'Shared memory not initialized in worker.' });
        return;
      }

      const t0 = performance.now();
      try {
        const result = await TaskRegistry.execute(taskId, ...(args || []));
        workerLog.debug(`task ${taskId} → ${(performance.now() - t0).toFixed(1)}ms`);
        self.postMessage({ messageId, success: true, result });
      } catch (err: any) {
        workerLog.warn(`task ${taskId} failed: ${err.message || String(err)}`);
        self.postMessage({ messageId, success: false, error: err.message || String(err) });
      }
    }
  };
}

installWorkerListener();
