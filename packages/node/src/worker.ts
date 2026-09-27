import { Worker as NodeWorker } from 'node:worker_threads';

type MessageHandler = (event: { data: unknown }) => void;

/**
 * Adapts node:worker_threads.Worker to the DOM Worker surface that
 * WorkerPool expects (`postMessage`, `terminate`, add/removeEventListener
 * with `event.data`). Node's Worker is an EventEmitter — 'message' delivers
 * the value directly, so handlers get wrapped and tracked by identity so
 * removeEventListener can detach the exact listener the pool installed.
 */
export class NodeWorkerAdapter {
  private readonly listeners = new Map<MessageHandler, (data: unknown) => void>();

  constructor(private readonly worker: NodeWorker) {}

  postMessage(message: unknown): void {
    this.worker.postMessage(message);
  }

  terminate(): void {
    void this.worker.terminate();
  }

  addEventListener(_type: 'message', handler: MessageHandler): void {
    const wrapped = (data: unknown) => handler({ data });
    this.listeners.set(handler, wrapped);
    this.worker.on('message', wrapped);
  }

  removeEventListener(_type: 'message', handler: MessageHandler): void {
    const wrapped = this.listeners.get(handler);
    if (wrapped) {
      this.worker.off('message', wrapped);
      this.listeners.delete(handler);
    }
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
