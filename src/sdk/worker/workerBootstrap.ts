import { TaskRegistry } from './registry';
import { bindSharedMemories } from '../contract/sharedMemory';
import { fmtBytes, scoped } from '../log';

const workerLog = scoped('worker');

let memoryInitialized = false;

if (typeof self === 'undefined') {
  // Imported outside a worker context (e.g. a Nest entry that shares the
  // mesh-nestjs barrel with the worker entry) — nothing to wire.
  workerLog.warn('workerBootstrap: no worker global found — skipping message wiring');
} else {
  self.onmessage = async (event) => {
  const data = event.data;

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
