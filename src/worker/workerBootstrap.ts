import { TaskRegistry } from './registry';
import { bindSharedMemories, getDefinedSharedMemoryCount } from '../contract/sharedMemory';
import { devtoolsEnabled, enableWorkerDevtoolsForwarding } from '../devtools';
import { fmtBytes, scoped } from '../log';
import { measureAtoll } from '../userTiming';

const workerLog = scoped('worker');

/** Worker-side span of one task execution, on this worker thread's 'tasks' track. */
const measureRun = (taskId: string, messageId: number, t0: number, ok: boolean): void => {
  const t1 = performance.now();
  measureAtoll(`atoll run ${taskId}`, t0, t1, {
    track: 'tasks',
    color: ok ? 'secondary' : 'error',
    properties: [['message', messageId], ['outcome', ok ? 'ok' : 'error']],
    tooltipText: `${taskId}: ${(t1 - t0).toFixed(1)}ms in worker`,
  });
};

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
      if (data.devtools) enableWorkerDevtoolsForwarding();
      if (getDefinedSharedMemoryCount() > 0) {
        workerLog.warn(
          'pool sent INIT without memory, but shared-memory contracts are defined — field access will throw until bound',
        );
      }
      workerLog.info('initialized (message-only pool — no shared memory)');
      return;
    }

    if (data.type === 'INIT_MEMORY') {
      // `memory` is the pool-allocated WebAssembly.Memory; `buffer` is an
      // existing SharedArrayBuffer the caller ships directly (sub-worker
      // shell, second pool sharing a buffer).
      const buffer =
        (data.memory as WebAssembly.Memory | undefined)?.buffer ??
        (data.buffer as SharedArrayBuffer | undefined);
      if (!buffer) {
        workerLog.warn('INIT_MEMORY arrived without a buffer — contracts stay unbound');
        return;
      }
      bindSharedMemories(buffer as unknown as SharedArrayBuffer);
      memoryInitialized = true;
      if (data.devtools) enableWorkerDevtoolsForwarding();
      workerLog.info(`shared memory initialized (${fmtBytes(buffer.byteLength)})`);
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
        if (devtoolsEnabled()) measureRun(taskId, messageId, t0, true);
        workerLog.debug(`task ${taskId} → ${(performance.now() - t0).toFixed(1)}ms`);
        self.postMessage({ messageId, success: true, result });
      } catch (err: any) {
        if (devtoolsEnabled()) measureRun(taskId, messageId, t0, false);
        workerLog.warn(`task ${taskId} failed: ${err.message || String(err)}`);
        self.postMessage({ messageId, success: false, error: err.message || String(err) });
      }
    }
  };
}

// Deferred to a microtask so the whole worker entry graph evaluates first:
// bundlers that flatten modules into shared chunks (rolldown/rollup) cannot
// guarantee this module runs after a `self`-binding shim, and deferring
// still beats the first inbound port message, which arrives on a later
// macrotask.
queueMicrotask(installWorkerListener);
