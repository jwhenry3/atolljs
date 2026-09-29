import { bindSharedMemories } from '../contract/sharedMemory';
import { MemoryManager } from '../pool/memory';
import { TaskRegistry } from '../worker/registry';
import { fmtBytes, scoped } from '../log';
import type { MemoryConfig } from '../contract/types';

const hostLog = scoped('shared-worker');

// Minimal shape — lib.dom doesn't model SharedWorkerGlobalScope reliably.
interface ConnectEvent {
  ports: readonly MessagePort[];
}
interface SharedWorkerScope {
  onconnect: ((event: ConnectEvent) => void) | null;
}

let memory: WebAssembly.Memory | null = null;
let clientCount = 0;

/**
 * Lazily creates the shared buffer on first connect. Unlike WorkerPool — where
 * the page allocates the buffer and pushes it to workers — the SharedWorker
 * owns the memory so every connecting page/tab binds to the SAME buffer.
 */
function ensureMemory(memoryBytes: number, config?: MemoryConfig): WebAssembly.Memory {
  if (memory) {
    if (memory.buffer.byteLength < memoryBytes) {
      hostLog.warn(
        `client requested ${fmtBytes(memoryBytes)} but buffer is ${fmtBytes(memory.buffer.byteLength)} — first client's capacity wins`
      );
    }
    return memory;
  }
  const manager = new MemoryManager(config);
  manager.ensureCapacity(memoryBytes);
  memory = manager.memory;
  bindSharedMemories(manager.getBuffer());
  hostLog.info(`shared buffer allocated (${fmtBytes(memory.buffer.byteLength)})`);
  return memory;
}

/**
 * Attaches the shared-worker protocol to one client port. Exported separately
 * so tests can drive it with a `MessageChannel` without a real SharedWorker.
 */
export function attachSharedPort(port: MessagePort): void {
  const index = ++clientCount;
  hostLog.info(`client #${index} connected`);

  port.onmessage = async (event: MessageEvent) => {
    const data = event.data;

    if (data?.type === 'SHARED_CONNECT') {
      const mem = ensureMemory(data.memoryBytes ?? 0, data.memory);
      port.postMessage({ type: 'SHARED_MEMORY', buffer: mem.buffer, clientIndex: index });
      return;
    }

    if (data?.type === 'EXECUTE_TASK') {
      const { messageId, taskId, args } = data;
      if (!memory) {
        port.postMessage({ messageId, success: false, error: 'Shared memory not initialized in worker.' });
        return;
      }
      const t0 = performance.now();
      try {
        const result = await TaskRegistry.execute(taskId, ...(args || []));
        hostLog.debug(`task ${taskId} → ${(performance.now() - t0).toFixed(1)}ms (client #${index})`);
        port.postMessage({ messageId, success: true, result });
      } catch (err: any) {
        hostLog.warn(`task ${taskId} failed: ${err.message || String(err)}`);
        port.postMessage({ messageId, success: false, error: err.message || String(err) });
      }
      return;
    }

    if (data?.type === 'SHARED_DISCONNECT') {
      port.close();
      hostLog.info(`client #${index} disconnected`);
    }
  };
  port.start();
}

/**
 * SharedWorker-side entry point — call once at the top of the shared worker
 * module, after registering task handlers:
 *
 * ```ts
 * import { sharedWorkerHost, TaskRegistry } from '@atolljs/core/sdk';
 * import './tasks';            // TaskRegistry.register(...) calls
 * sharedWorkerHost();
 * ```
 *
 * Each page/tab/iframe that opens this SharedWorker gets a MessagePort here;
 * all of them bind the same contract to the same SharedArrayBuffer. Ports are
 * the control plane (handshake + task dispatch) — state itself never crosses
 * them; clients observe shared fields directly via Atomics version counters.
 */
export function sharedWorkerHost(): void {
  (self as unknown as SharedWorkerScope).onconnect = (event) => {
    attachSharedPort(event.ports[0]);
  };
}
