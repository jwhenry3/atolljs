import { SharedAccess, SharedMemory, SharedSpec } from '../contract/sharedMemory';
import { PoolTasks, TaskContract, TaskMap, TaskResult, SharedWorkerConfig } from '../contract/types';
import { scoped } from '../log';

const clientLog = scoped('shared-client');
const taskLog = scoped('task');

class SharedWorkerClientImpl<S extends SharedSpec = SharedSpec> {
  public readonly sharedMemory: SharedMemory<S> & SharedAccess<S>;
  private readonly port: MessagePort;

  constructor(
    port: MessagePort,
    public readonly clientIndex: number,
    config: SharedWorkerConfig<S, TaskMap>
  ) {
    this.port = port;
    this.sharedMemory = config.sharedMemory;

    // Install first-class task methods, same convention as WorkerPool.
    const tasks = config.tasks ?? {};
    for (const [name, contract] of Object.entries(tasks)) {
      if (name in this) {
        clientLog.warn(`task "${name}" collides with a SharedWorkerClient member — not installed`);
        continue;
      }
      (this as Record<string, unknown>)[name] = (...args: unknown[]) =>
        this.runTask(contract as TaskContract<any[], any>, ...(args as any[]));
    }
    if (Object.keys(tasks).length > 0) {
      clientLog.info(`task methods: ${Object.keys(tasks).join(', ')}`);
    }
  }

  /** Dispatches a task to the shared worker; the reply comes back on this client's port. */
  public runTask<Args extends any[], Result>(contract: TaskContract<Args, Result>, ...args: Args): Promise<Result> {
    return new Promise((resolve, reject) => {
      const messageId = Math.random().toString(36).substring(2);
      const t0 = performance.now();
      taskLog.debug(`→ ${contract.taskId}`, { args });

      const handleMessage = (event: MessageEvent) => {
        const data = event.data as TaskResult & { messageId?: string };
        if (data.messageId === messageId) {
          this.port.removeEventListener('message', handleMessage);
          const ms = (performance.now() - t0).toFixed(1);
          if (data.success) {
            taskLog.debug(`← ${contract.taskId} ok`, { ms: +ms });
            resolve(data.result);
          } else {
            taskLog.warn(`← ${contract.taskId} failed: ${data.error}`, { ms: +ms });
            reject(new Error(data.error));
          }
        }
      };

      this.port.addEventListener('message', handleMessage);
      this.port.postMessage({ type: 'EXECUTE_TASK', messageId, taskId: contract.taskId, args });
    });
  }

  /** Detaches this client. The shared worker (and its buffer) stay alive for other clients. */
  public disconnect(): void {
    try {
      this.port.postMessage({ type: 'SHARED_DISCONNECT' });
    } finally {
      this.port.close();
    }
  }
}

/**
 * A SharedWorkerClient with first-class task methods baked in from
 * `config.tasks` — same shape as `WorkerPool`.
 */
export type SharedWorkerClient<S extends SharedSpec = SharedSpec, T extends TaskMap = TaskMap> =
  SharedWorkerClientImpl<S> & PoolTasks<T>;

/**
 * Connects this page to a `SharedWorker`. The worker owns the SharedArrayBuffer
 * and shares it with every connecting client — so every page/tab/iframe bound
 * to the same contract reads and writes the same memory. State propagation
 * needs no messaging: writes bump shared version counters via Atomics, which
 * `observe`/`watch` subscribers in every context are already parked on.
 * Ports carry only the connect handshake and task dispatch.
 *
 * ```ts
 * const worker = await connectSharedWorker({
 *   createWorker: () => new SharedWorker(new URL('./incidents.sharedWorker.ts', import.meta.url), { type: 'module' }),
 *   sharedMemory: incidentsMemory,
 *   tasks: { initIncidents: InitIncidents, queryIncidents: QueryIncidents },
 * });
 * ```
 */
export async function connectSharedWorker<S extends SharedSpec = SharedSpec, T extends TaskMap = TaskMap>(
  config: SharedWorkerConfig<S, T>
): Promise<SharedWorkerClient<S, T>> {
  if (typeof SharedArrayBuffer === 'undefined' || (typeof crossOriginIsolated !== 'undefined' && !crossOriginIsolated)) {
    throw new Error(
      'connectSharedWorker requires SharedArrayBuffer in a cross-origin isolated context — serve the page with COOP/COEP headers.'
    );
  }
  if (!config.port && !config.workerUrl && !config.createWorker) {
    throw new Error('connectSharedWorker requires `workerUrl`, `createWorker`, or `port` in its config.');
  }

  const port =
    config.port ??
    (config.createWorker
      ? config.createWorker().port
      : new SharedWorker(config.workerUrl!, { type: 'module' }).port);
  port.start();

  const client = await new Promise<SharedWorkerClient<S, T>>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('connectSharedWorker: timed out waiting for the shared worker — is the host module calling sharedWorkerHost()?')),
      config.connectTimeoutMs ?? 10_000
    );

    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (data?.type === 'SHARED_MEMORY') {
        port.removeEventListener('message', handleMessage);
        clearTimeout(timeout);
        config.sharedMemory.bind(data.buffer as SharedArrayBuffer);
        clientLog.info(`connected as client #${data.clientIndex}`, {
          bytes: data.buffer.byteLength,
        });
        resolve(new SharedWorkerClientImpl<S>(port, data.clientIndex, config) as SharedWorkerClient<S, T>);
      }
    };

    port.addEventListener('message', handleMessage);
    port.postMessage({
      type: 'SHARED_CONNECT',
      memoryBytes: config.sharedMemory.totalBytes,
      memory: config.memory,
    });
  });

  return client;
}
