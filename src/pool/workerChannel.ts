/**
 * The per-worker plumbing both runners share: `WorkerPool` (N workers,
 * queue + least-busy scheduling) and `DedicatedWorker` (one worker, no
 * pool). Memory setup, the INIT handshake, and devtools forwarding are the
 * same protocol whichever runner owns the worker.
 */
import { MemoryManager } from './memory';
import type { SharedAccess, SharedMemory, SharedSpec } from '../contract/sharedMemory';
import type { MemoryPersistence, TaskMap, WorkerPoolConfig } from '../contract/types';
import { devtoolsEnabled, forwardDevtools, type EmittedDevtoolsEvent } from '../devtools';

export interface ChannelMemory<S extends SharedSpec> {
  sharedMemory: (SharedMemory<S> & SharedAccess<S>) | undefined;
  memoryManager?: MemoryManager;
  /** A caller-supplied buffer shipped via INIT_MEMORY (sub-worker / second-runner sharing). */
  injectedBuffer?: SharedArrayBuffer;
  persistence: MemoryPersistence | undefined;
}

/**
 * Resolve the runner's memory once, at construction: a caller-supplied
 * buffer binds the contract to those bytes, otherwise a fresh
 * WebAssembly.Memory is allocated. Message-only runners get neither.
 */
export function setupChannelMemory<S extends SharedSpec>(
  config: WorkerPoolConfig<S, TaskMap>,
  owner: string,
): ChannelMemory<S> {
  if (config.sharedMemory || config.sharedBuffer !== undefined) {
    if (typeof SharedArrayBuffer === 'undefined' || (typeof crossOriginIsolated !== 'undefined' && !crossOriginIsolated)) {
      throw new Error(
        `${owner} requires SharedArrayBuffer in a cross-origin isolated context — serve the page with COOP/COEP headers.`
      );
    }
  }
  let injectedBuffer: SharedArrayBuffer | undefined;
  if (config.sharedBuffer !== undefined) {
    injectedBuffer = typeof config.sharedBuffer === 'function' ? config.sharedBuffer() : config.sharedBuffer;
    if (!injectedBuffer) {
      throw new Error(
        `${owner}: \`sharedBuffer\` resolved to an empty buffer — the producing pool or contract has no bound memory yet.`
      );
    }
  }
  if (!config.sharedMemory) return { sharedMemory: undefined, injectedBuffer, persistence: undefined };

  const sharedMemory = config.sharedMemory;
  let memoryManager: MemoryManager | undefined;
  if (injectedBuffer) {
    sharedMemory.bind(injectedBuffer);
  } else {
    memoryManager = new MemoryManager(config.memory);
    memoryManager.ensureCapacity(sharedMemory.totalBytes);
    sharedMemory.bind(memoryManager.getBuffer());
  }
  return { sharedMemory, memoryManager, injectedBuffer, persistence: config.persistence?.(sharedMemory) };
}

/**
 * The INIT handshake: INIT_MEMORY with the runner's memory (or the injected
 * buffer), bare INIT for message-only runners. `devtools` tells the worker
 * to forward its instrumentation back only when a sink is live at spawn.
 */
export function sendInit<S extends SharedSpec>(worker: Worker, mem: ChannelMemory<S>): 'INIT' | 'INIT_MEMORY' {
  if (mem.memoryManager) {
    worker.postMessage({ type: 'INIT_MEMORY', memory: mem.memoryManager.memory, devtools: devtoolsEnabled() });
    return 'INIT_MEMORY';
  }
  if (mem.injectedBuffer) {
    worker.postMessage({ type: 'INIT_MEMORY', buffer: mem.injectedBuffer, devtools: devtoolsEnabled() });
    return 'INIT_MEMORY';
  }
  worker.postMessage({ type: 'INIT', devtools: devtoolsEnabled() });
  return 'INIT';
}

/**
 * Re-emit a worker-forwarded devtools event into this thread's sink.
 *
 * A runner constructed inside a worker mints ids ('pool-1', 'worker-1') on
 * that context's own counters, which collide textually with ids minted on
 * the parent thread. Every id arriving from a worker refers to the worker's
 * local id space, so it is qualified unconditionally as
 * `${runnerId}#${slot}~${id}`: the id then encodes the spawn path and
 * dashboards can draw parent→child edges. Existing `worker` stamps
 * (multi-hop forwarding) are qualified the same way so attribution stays
 * pinned to the deepest emitting worker.
 */
export function forwardWorkerDevtools(runnerId: string, slot: number, ev: EmittedDevtoolsEvent & { poolId?: string }): void {
  const qualify = (id: string): string => `${runnerId}#${slot}~${id}`;
  forwardDevtools({
    ...ev,
    ...(ev.poolId !== undefined ? { poolId: qualify(ev.poolId) } : {}),
    worker:
      ev.worker === undefined
        ? { poolId: runnerId, slot }
        : { poolId: qualify(ev.worker.poolId), slot: ev.worker.slot },
  });
}
