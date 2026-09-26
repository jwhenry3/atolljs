import { MemoryManager } from './memory';
import { SharedAccess, SharedMemory, SharedSpec } from '../contract/sharedMemory';
import { PoolTasks, TaskContract, TaskMap, TaskResult, WorkerPoolConfig } from '../contract/types';
import { fmtBytes, scoped } from '../log';

const poolLog = scoped('pool');
const taskLog = scoped('task');

class WorkerPoolImpl<S extends SharedSpec = SharedSpec> {
  private workers: Worker[] = [];
  private activeWorkerIndex = 0;
  private memoryManager: MemoryManager;
  private workerUrl?: URL;
  private spawn: () => Worker;
  public readonly sharedMemory: SharedMemory<S> & SharedAccess<S>;

  constructor(config: WorkerPoolConfig<S, TaskMap>) {
    if (typeof SharedArrayBuffer === 'undefined' || (typeof crossOriginIsolated !== 'undefined' && !crossOriginIsolated)) {
      throw new Error(
        'WorkerPool requires SharedArrayBuffer in a cross-origin isolated context — serve the page with COOP/COEP headers.'
      );
    }
    if (!config.workerUrl && !config.createWorker) {
      throw new Error('WorkerPool requires either `workerUrl` or `createWorker` in its config.');
    }
    this.workerUrl = config.workerUrl;
    this.spawn = config.createWorker ?? (() => new Worker(this.workerUrl!, { type: 'module' }));
    this.sharedMemory = config.sharedMemory;
    this.memoryManager = new MemoryManager(config.memory);
    this.memoryManager.ensureCapacity(this.sharedMemory.totalBytes);
    this.sharedMemory.bind(this.memoryManager.getBuffer());
    const requestedSize = config.poolSize ?? 'auto';
    const poolSize =
      requestedSize === 'auto' ? (navigator.hardwareConcurrency ?? 4) : requestedSize;

    poolLog.info(`spawning ${poolSize} worker(s) with ${fmtBytes(this.sharedMemory.totalBytes)} shared buffer`, {
      workerUrl: config.workerUrl ? String(config.workerUrl) : 'createWorker()',
    });
    poolLog.debug(`tip: setLogLevel('trace') for per-task detail`);

    for (let i = 0; i < poolSize; i++) {
      const worker = this.spawn();
      
      // Perform initial handshake to hand over the shared memory buffer
      worker.postMessage({
        type: 'INIT_MEMORY',
        memory: this.memoryManager.memory,
      });

      this.workers.push(worker);
      poolLog.debug(`worker #${i} spawned, INIT_MEMORY sent`);
    }

    // Install first-class task methods: pool.queryIncidents(q) →
    // runTask(QueryIncidents, q). Typed through PoolTasks<T> at the
    // WorkerPool constructor signature.
    const tasks = config.tasks ?? {};
    for (const [name, contract] of Object.entries(tasks)) {
      if (name in this) {
        poolLog.warn(`task "${name}" collides with a WorkerPool member — not installed`);
        continue;
      }
      (this as Record<string, unknown>)[name] = (...args: unknown[]) =>
        this.runTask(contract as TaskContract<any[], any>, ...(args as any[]));
    }
    if (Object.keys(tasks).length > 0) {
      poolLog.info(`task methods: ${Object.keys(tasks).join(', ')}`);
    }
  }

  /**
   * Dispatches a task to the next available worker in a round-robin pool.
   * The task contract guarantees the argument and result types across the thread boundary.
   */
  public runTask<Args extends any[], Result>(contract: TaskContract<Args, Result>, ...args: Args): Promise<Result> {
    if (this.workers.length === 0) {
      return Promise.reject(new Error('WorkerPool has been terminated — no workers available.'));
    }
    return new Promise((resolve, reject) => {
      const workerIndex = this.activeWorkerIndex;
      const worker = this.workers[workerIndex];
      this.activeWorkerIndex = (this.activeWorkerIndex + 1) % this.workers.length;

      const messageId = Math.random().toString(36).substring(2);
      const t0 = performance.now();
      taskLog.debug(`→ ${contract.taskId}`, { worker: workerIndex, args });

      const handleMessage = (event: MessageEvent) => {
        const data = event.data as TaskResult & { messageId?: string };
        if (data.messageId === messageId) {
          worker.removeEventListener('message', handleMessage);
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

      worker.addEventListener('message', handleMessage);
      
      worker.postMessage({
        type: 'EXECUTE_TASK',
        messageId,
        taskId: contract.taskId,
        args,
      });
    });
  }

  public terminate(): void {
    poolLog.info(`terminating ${this.workers.length} worker(s)`);
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
  }
}

/**
 * A WorkerPool with first-class task methods baked in from `config.tasks`.
 * Constructed as `new WorkerPool({ workerUrl, sharedMemory, tasks })` —
 * `tasks: { queryIncidents: QueryIncidents }` exposes `pool.queryIncidents(q)`
 * with the contract's declared args/result types.
 */
export type WorkerPool<S extends SharedSpec = SharedSpec, T extends TaskMap = TaskMap> =
  WorkerPoolImpl<S> & PoolTasks<T>;

export const WorkerPool = WorkerPoolImpl as {
  new <S extends SharedSpec = SharedSpec, T extends TaskMap = TaskMap>(
    config: WorkerPoolConfig<S, T>
  ): WorkerPool<S, T>;
};
