import { Worker as NodeWorker } from 'node:worker_threads';

export interface WorkerErrorEvent {
  type: 'error';
  message: string;
  error?: unknown;
}
type EventHandler = (event: any) => void;
type NodeEvent = 'message' | 'error' | 'exit';

/**
 * Adapts node:worker_threads.Worker to the DOM Worker surface that
 * WorkerPool expects (`postMessage`, `terminate`, add/removeEventListener
 * with `event.data`). Node's Worker is an EventEmitter — 'message' delivers
 * the value directly, so handlers get wrapped and tracked by identity so
 * removeEventListener can detach the exact listener the pool installed.
 *
 * 'error' listeners additionally observe a Node 'exit' with code ≠ 0 —
 * surfaced as `{ type: 'error', message }` so the pool's crash/respawn
 * path sees silent exits too. `exit(0)` is a clean shutdown, not an error.
 */
export class NodeWorkerAdapter {
  private readonly listeners = new Map<EventHandler, Map<NodeEvent, (...args: any[]) => void>>();

  constructor(private readonly worker: NodeWorker) {}

  postMessage(message: unknown, transferList?: unknown[]): void {
    if (transferList === undefined) {
      this.worker.postMessage(message);
    } else {
      this.worker.postMessage(message, transferList as never);
    }
  }

  terminate(): void {
    void this.worker.terminate();
  }

  addEventListener(type: 'message', handler: (event: { data: unknown }) => void): void;
  addEventListener(type: 'error', handler: (event: WorkerErrorEvent) => void): void;
  addEventListener(type: 'message' | 'error', handler: EventHandler): void {
    let map = this.listeners.get(handler);
    if (!map) this.listeners.set(handler, (map = new Map()));
    if (type === 'message') {
      const wrapped = (data: unknown) => handler({ data });
      map.set('message', wrapped);
      this.worker.on('message', wrapped);
    } else {
      const onError = (error: Error) =>
        handler({ type: 'error', message: error.message, error });
      const onExit = (code: number) => {
        if (code !== 0) {
          handler({ type: 'error', message: `worker exited with code ${code}` });
        }
      };
      map.set('error', onError);
      map.set('exit', onExit);
      this.worker.on('error', onError);
      this.worker.on('exit', onExit);
    }
  }

  removeEventListener(type: 'message', handler: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'error', handler: (event: WorkerErrorEvent) => void): void;
  removeEventListener(type: 'message' | 'error', handler: EventHandler): void {
    const map = this.listeners.get(handler);
    if (!map) return;
    const events: NodeEvent[] = type === 'message' ? ['message'] : ['error', 'exit'];
    for (const ev of events) {
      const wrapped = map.get(ev);
      if (wrapped) {
        this.worker.off(ev, wrapped);
        map.delete(ev);
      }
    }
    if (map.size === 0) this.listeners.delete(handler);
  }
}

/**
 * Wraps node:worker_threads.Worker creation. Pass a file/URL to spawn, or an
 * already-constructed Worker to adapt — the latter enables the
 * bundler-detectable form in pool configs:
 *
 *   createWorker: () => createNodeWorker(
 *     new NodeWorker(new URL('./my.worker.ts', import.meta.url))
 *   )
 *
 * webpack compiles the referenced entry into its own chunk and rewrites the
 * URL to the emitted file — the config points at the TS source, never at a
 * dist filename.
 */
export function createNodeWorker(
  source: string | URL | NodeWorker,
  options?: ConstructorParameters<typeof NodeWorker>[1],
): Worker {
  const worker = source instanceof NodeWorker ? source : new NodeWorker(source, options);
  return new NodeWorkerAdapter(worker) as unknown as Worker;
}
