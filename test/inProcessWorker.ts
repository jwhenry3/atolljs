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
  private listeners = {
    message: new Set<(event: { data: any }) => void>(),
    error: new Set<(event: any) => void>(),
  };
  private ready: Promise<unknown> | null = null;
  /** Module-load failure — a crashed worker never executes another task. */
  private dead = false;

  constructor(public url: URL, public options?: any) {
    InProcessWorker.created.push(this);
  }

  postMessage(data: any) {
    queueMicrotask(() => void this.handle(data));
  }

  /** Imports the registered handler modules — what a real worker's entry does at boot. */
  private boot(): Promise<unknown> {
    return (async () => {
      // workerBootstrap assigns self.onmessage at module load — provide a
      // minimal stand-in so the real worker entry can be imported in-process.
      (globalThis as { self?: unknown }).self ??= {
        postMessage() {},
        onmessage: null,
      };
      for (const load of InProcessWorker.handlerModules) await load();
    })();
  }

  /** Module-load failure = a real worker's 'error' event. */
  private crashOnBoot(err: unknown): void {
    // A real worker whose entry module fails to load fires 'error' and never
    // answers a task — mirror that so pools reject in-flight calls (and
    // respawn) instead of hanging on a ready that never resolves.
    this.dead = true;
    const event = {
      type: 'error',
      message: `worker entry failed to load: ${(err as Error)?.message ?? String(err)}`,
      error: err instanceof Error ? err : new Error(String(err)),
    };
    for (const l of this.listeners.error) l(event);
  }

  private async handle(data: any) {
    if (data.type === 'INIT') {
      // Message-only pool — the entry still loads; just no shared buffer.
      this.ready ??= this.boot();
      try {
        await this.ready;
      } catch (err) {
        this.crashOnBoot(err);
      }
      return;
    }
    if (data.type === 'INIT_MEMORY') {
      this.ready ??= this.boot().then(() =>
        bindSharedMemories((data.memory as WebAssembly.Memory).buffer as unknown as SharedArrayBuffer),
      );
      try {
        await this.ready;
      } catch (err) {
        this.crashOnBoot(err);
      }
      return;
    }
    if (data.type === 'EXECUTE_TASK') {
      if (this.dead) return;
      try {
        await this.ready;
      } catch {
        // Boot failed in the meantime — a crashed worker drops the task
        // (the INIT handler already fired 'error').
        return;
      }
      if (this.dead) return;
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
    for (const l of this.listeners.message) l({ data: msg });
  }

  /** Simulates a worker crash: fires 'error' listeners like a real worker's error event. */
  crash(message = 'simulated crash') {
    const event = { type: 'error', message, error: new Error(message) };
    for (const l of this.listeners.error) l(event);
  }

  addEventListener(type: string, l: (event: any) => void) {
    if (type === 'error') this.listeners.error.add(l);
    else this.listeners.message.add(l);
  }
  removeEventListener(type: string, l: (event: any) => void) {
    if (type === 'error') this.listeners.error.delete(l);
    else this.listeners.message.delete(l);
  }
  terminate() { this.terminated = true; }
}

/** Flushes microtasks + the waitAsync observer loop after a shared write. */
export const flushObservers = () => new Promise((r) => setTimeout(r, 5));
