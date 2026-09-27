/**
 * Test double for the Worker global that runs the real worker protocol
 * in-process: INIT_MEMORY binds every defined shared-memory contract to the
 * pool's buffer, EXECUTE_TASK dispatches through the real TaskRegistry.
 * Everything except the OS thread boundary is real.
 *
 * Register worker-entry modules via `InProcessWorker.handlerModules` —
 * importing them performs their TaskRegistry.register side effects, exactly
 * what a bundled worker entry does at boot.
 */
import { bindSharedMemories } from '../src/sdk/contract/sharedMemory';
import { TaskRegistry } from '../src/sdk/worker/registry';

export class InProcessWorker {
  static created: InProcessWorker[] = [];
  static handlerModules: Array<() => Promise<unknown>> = [];

  public executed: any[] = [];
  public terminated = false;
  private listeners = new Set<(event: { data: any }) => void>();
  private ready: Promise<unknown> | null = null;

  constructor(public url: URL, public options?: any) {
    InProcessWorker.created.push(this);
  }

  postMessage(data: any) {
    queueMicrotask(() => void this.handle(data));
  }

  private async handle(data: any) {
    if (data.type === 'INIT_MEMORY') {
      this.ready ??= (async () => {
        // workerBootstrap assigns self.onmessage at module load — provide a
        // minimal stand-in so the real worker entry can be imported in-process.
        (globalThis as { self?: unknown }).self ??= {
          postMessage() {},
          onmessage: null,
        };
        for (const load of InProcessWorker.handlerModules) await load();
        bindSharedMemories((data.memory as WebAssembly.Memory).buffer as unknown as SharedArrayBuffer);
      })();
      await this.ready;
      return;
    }
    if (data.type === 'EXECUTE_TASK') {
      await this.ready;
      this.executed.push(data);
      try {
        const result = await TaskRegistry.execute(data.taskId, ...(data.args || []));
        this.emit({ messageId: data.messageId, success: true, result });
      } catch (err: any) {
        this.emit({ messageId: data.messageId, success: false, error: err.message || String(err) });
      }
    }
  }

  private emit(msg: any) {
    for (const l of this.listeners) l({ data: msg });
  }

  addEventListener(_t: string, l: (event: { data: any }) => void) { this.listeners.add(l); }
  removeEventListener(_t: string, l: (event: { data: any }) => void) { this.listeners.delete(l); }
  terminate() { this.terminated = true; }
}

/** Flushes microtasks + the waitAsync observer loop after a shared write. */
export const flushObservers = () => new Promise((r) => setTimeout(r, 5));
