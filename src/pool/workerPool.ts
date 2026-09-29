import { MemoryManager } from './memory';
import { PoolQueueFullError, TaskAbortedError, TaskTimeoutError, WorkerCrashedError } from './errors';
import { SharedAccess, SharedMemory, SharedSpec } from '../contract/sharedMemory';
import { MemoryPersistence, PoolTasks, TaskContract, TaskMap, TaskResult, WorkerPoolConfig } from '../contract/types';
import { fmtBytes, scoped } from '../log';

const poolLog = scoped('pool');
const taskLog = scoped('task');

/** Per-call dispatch controls. */
export interface RunOptions {
  /**
   * Cancels the call: a queued task is removed and rejects with
   * TaskAbortedError; an in-flight task rejects immediately and the worker's
   * eventual reply is discarded. JS cannot be interrupted — the worker keeps
   * running, and the worker's slot is released only when its reply arrives.
   * Callers needing a hard cancel should `terminate()`.
   */
  signal?: AbortSignal;
  /**
   * Per-call timeout in ms — overrides the pool's `taskTimeout`. The timer
   * starts at enqueue, so it bounds queue-wait + execution time together.
   */
  timeout?: number;
}

interface RunningAgg {
  count: number;
  mean: number;
  max: number;
  add(v: number): void;
}
const agg = (): RunningAgg => ({
  count: 0,
  mean: 0,
  max: 0,
  add(v: number) {
    this.count++;
    this.mean += (v - this.mean) / this.count;
    if (v > this.max) this.max = v;
  },
});

export interface PoolStats {
  workers: number;
  idle: number;
  inFlight: number;
  queued: number;
  completed: number;
  failed: number;
  aborted: number;
  /** queue→dispatch timings. */
  waitMs: { count: number; mean: number; max: number };
  /** dispatch→reply timings. */
  runMs: { count: number; mean: number; max: number };
}

/** One dispatched call — first queued, then in-flight on a worker slot. */
interface TaskEntry {
  contract: TaskContract<any[], any>;
  args: any[];
  enqueuedAt: number;
  resolve: (v: any) => void;
  reject: (e: unknown) => void;
  /** Finalized — settled (or reply already discarded); no further transitions. */
  done: boolean;
  /** Set once handed to a worker. */
  messageId?: number;
  slot?: WorkerSlot;
  sentAt?: number;
  timer?: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onSignalAbort?: () => void;
}

interface WorkerSlot {
  worker: Worker;
  inFlight: number;
}

class WorkerPoolImpl<S extends SharedSpec = SharedSpec> {
  private slots: WorkerSlot[] = [];
  private pending = new Map<number, TaskEntry>();
  private nextMessageId = 0;
  private queue: TaskEntry[] = [];
  private memoryManager?: MemoryManager;
  private workerUrl?: URL;
  private spawn: () => Worker;
  private readonly concurrency: number;
  private readonly maxQueue: number;
  private readonly respawn: boolean;
  private readonly taskTimeout?: number;
  private closed = false;
  private drainWaiters: Array<() => void> = [];
  private statsAgg = {
    completed: 0,
    failed: 0,
    /** aborts + timeouts. */
    aborted: 0,
    waitMs: agg(),
    runMs: agg(),
  };
  public readonly sharedMemory: (SharedMemory<S> & SharedAccess<S>) | undefined;
  /** The attached memory-persistence adapter, if the config supplied one. */
  public readonly persistence: MemoryPersistence | undefined;

  constructor(config: WorkerPoolConfig<S, TaskMap>) {
    if (config.sharedMemory) {
      if (typeof SharedArrayBuffer === 'undefined' || (typeof crossOriginIsolated !== 'undefined' && !crossOriginIsolated)) {
        throw new Error(
          'WorkerPool requires SharedArrayBuffer in a cross-origin isolated context — serve the page with COOP/COEP headers.'
        );
      }
    }
    if (!config.workerUrl && !config.createWorker) {
      throw new Error('WorkerPool requires either `workerUrl` or `createWorker` in its config.');
    }
    this.workerUrl = config.workerUrl;
    this.spawn = config.createWorker ?? (() => new Worker(this.workerUrl!, { type: 'module' }));
    this.concurrency = config.concurrency ?? 1;
    this.maxQueue = config.maxQueue ?? Infinity;
    this.respawn = config.respawn ?? true;
    this.taskTimeout = config.taskTimeout;

    if (config.sharedMemory) {
      this.sharedMemory = config.sharedMemory;
      this.memoryManager = new MemoryManager(config.memory);
      this.memoryManager.ensureCapacity(this.sharedMemory.totalBytes);
      this.sharedMemory.bind(this.memoryManager.getBuffer());
      this.persistence = config.persistence?.(config.sharedMemory);
    }

    const requestedSize = config.poolSize ?? 'auto';
    const poolSize =
      requestedSize === 'auto' ? (navigator.hardwareConcurrency ?? 4) : requestedSize;

    poolLog.info(
      this.sharedMemory
        ? `spawning ${poolSize} worker(s) with ${fmtBytes(this.sharedMemory.totalBytes)} shared buffer`
        : `spawning ${poolSize} worker(s), message-only`,
      { workerUrl: config.workerUrl ? String(config.workerUrl) : 'createWorker()' },
    );
    poolLog.debug(`tip: setLogLevel('trace') for per-task detail`);

    for (let i = 0; i < poolSize; i++) {
      this.addWorker(this.spawn());
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

  /** Adds a spawned worker: one message + one error listener, then the INIT handshake. */
  private addWorker(worker: Worker): WorkerSlot {
    const slot: WorkerSlot = { worker, inFlight: 0 };
    worker.addEventListener('message', (event: MessageEvent) => {
      this.handleReply(slot, event.data as TaskResult & { messageId?: number });
    });
    worker.addEventListener('error', (event: unknown) => {
      this.handleWorkerError(slot, event);
    });
    if (this.memoryManager) {
      worker.postMessage({ type: 'INIT_MEMORY', memory: this.memoryManager.memory });
    } else {
      worker.postMessage({ type: 'INIT' });
    }
    this.slots.push(slot);
    poolLog.debug(`worker spawned, ${this.memoryManager ? 'INIT_MEMORY' : 'INIT'} sent`);
    return slot;
  }

  private handleReply(slot: WorkerSlot, data: TaskResult & { messageId?: number }) {
    const entry = data.messageId !== undefined ? this.pending.get(data.messageId) : undefined;
    if (!entry) return; // stray reply — discard
    this.pending.delete(data.messageId!);
    slot.inFlight--;
    this.detach(entry);
    // Orphaned (aborted/timed-out) entries free the slot here but skip
    // stats and settlement — the caller was already rejected.
    if (!entry.done) {
      entry.done = true;
      this.statsAgg.runMs.add(performance.now() - (entry.sentAt ?? entry.enqueuedAt));
      if (data.success) {
        this.statsAgg.completed++;
        taskLog.debug(`← ${entry.contract.taskId} ok`);
        entry.resolve(data.result);
      } else {
        this.statsAgg.failed++;
        taskLog.warn(`← ${entry.contract.taskId} failed: ${data.error}`);
        entry.reject(new Error(data.error));
      }
    }
    this.drainQueue();
    this.checkDrained();
  }

  private handleWorkerError(slot: WorkerSlot, event: unknown) {
    if (this.closed) return; // pool terminated — a late error event can't respawn
    const e = event as { message?: string; error?: Error } | undefined;
    const message = e?.message ?? (e?.error ? String(e.error) : 'worker error');
    poolLog.warn(`worker error: ${message}`);

    // Reject the dead worker's in-flight tasks. Orphaned (already
    // aborted/timed-out) entries are dropped without re-counting.
    for (const [id, entry] of [...this.pending]) {
      if (entry.slot === slot) {
        this.pending.delete(id);
        this.detach(entry);
        if (entry.done) continue;
        entry.done = true;
        this.statsAgg.failed++;
        entry.reject(new WorkerCrashedError(message));
      }
    }

    const idx = this.slots.indexOf(slot);
    if (idx >= 0) this.slots.splice(idx, 1);
    slot.worker.terminate();

    if (this.respawn) {
      poolLog.info('respawning crashed worker');
      this.addWorker(this.spawn());
    } else if (this.slots.length === 0) {
      // No workers left to ever serve the queue.
      for (const entry of this.queue.splice(0)) {
        entry.done = true;
        this.detach(entry);
        this.statsAgg.failed++;
        entry.reject(new WorkerCrashedError(message));
      }
    }
    this.drainQueue();
    this.checkDrained();
  }

  /** Least-busy worker below its concurrency cap, if any. */
  private pickWorker(): WorkerSlot | undefined {
    let best: WorkerSlot | undefined;
    for (const slot of this.slots) {
      if (slot.inFlight >= this.concurrency) continue;
      if (!best || slot.inFlight < best.inFlight) best = slot;
    }
    return best;
  }

  private drainQueue() {
    let slot: WorkerSlot | undefined;
    while (this.queue.length > 0 && (slot = this.pickWorker())) {
      const entry = this.queue.shift()!;
      if (entry.done) continue;
      this.send(slot, entry);
    }
  }

  private send(slot: WorkerSlot, entry: TaskEntry) {
    const messageId = this.nextMessageId++;
    entry.messageId = messageId;
    entry.slot = slot;
    entry.sentAt = performance.now();
    this.statsAgg.waitMs.add(performance.now() - entry.enqueuedAt);
    slot.inFlight++;
    this.pending.set(messageId, entry);
    taskLog.debug(`→ ${entry.contract.taskId}`, { worker: this.slots.indexOf(slot), args: entry.args });
    slot.worker.postMessage({
      type: 'EXECUTE_TASK',
      messageId,
      taskId: entry.contract.taskId,
      args: entry.args,
    });
  }

  /** Detaches signal/timeout listeners from a finalized entry. */
  private detach(entry: TaskEntry) {
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.signal && entry.onSignalAbort) {
      entry.signal.removeEventListener('abort', entry.onSignalAbort);
    }
  }

  /**
   * Abort/timeout path: a queued task is removed outright; an in-flight task
   * stays in `pending` as an orphan — the worker is still running it, so the
   * slot remains occupied until the reply arrives (handleReply frees it).
   */
  private cancel(entry: TaskEntry, err: Error) {
    if (entry.done) return;
    const qi = this.queue.indexOf(entry);
    if (qi >= 0) this.queue.splice(qi, 1);
    entry.done = true;
    this.detach(entry);
    this.statsAgg.aborted++;
    entry.reject(err);
    this.drainQueue();
    this.checkDrained();
  }

  private checkDrained() {
    if (this.queue.length === 0 && this.pending.size === 0) {
      const waiters = this.drainWaiters.splice(0);
      for (const w of waiters) w();
    }
  }

  /**
   * Full dispatch: least-busy scheduling, `concurrency` cap per worker,
   * FIFO queue bounded by `maxQueue`, abort/timeout, and queue→reply timing.
   */
  public dispatch<Args extends any[], Result>(
    contract: TaskContract<Args, Result>,
    args: Args,
    options?: RunOptions,
  ): Promise<Result> {
    if (this.closed || this.slots.length === 0) {
      return Promise.reject(new WorkerCrashedError('WorkerPool has been terminated — no workers available.'));
    }
    if (options?.signal?.aborted) {
      return Promise.reject(new TaskAbortedError());
    }
    return new Promise<Result>((resolve, reject) => {
      const entry: TaskEntry = {
        contract,
        args: args as any[],
        enqueuedAt: performance.now(),
        resolve,
        reject,
        done: false,
        signal: options?.signal,
      };
      if (options?.signal) {
        entry.onSignalAbort = () => this.cancel(entry, new TaskAbortedError());
        options.signal.addEventListener('abort', entry.onSignalAbort, { once: true });
      }
      const timeout = options?.timeout ?? this.taskTimeout;
      if (timeout !== undefined) {
        entry.timer = setTimeout(() => this.cancel(entry, new TaskTimeoutError()), timeout);
      }

      const slot = this.pickWorker();
      if (slot) {
        this.send(slot, entry);
      } else if (this.queue.length >= this.maxQueue) {
        entry.done = true;
        this.detach(entry);
        reject(new PoolQueueFullError()); // never dispatched — stats untouched
        return;
      } else {
        this.queue.push(entry);
      }
    });
  }

  /**
   * Dispatches a task to the least-busy worker in the pool.
   * The task contract guarantees the argument and result types across the thread boundary.
   */
  public runTask<Args extends any[], Result>(contract: TaskContract<Args, Result>, ...args: Args): Promise<Result> {
    return this.dispatch(contract, args);
  }

  /**
   * The shared buffer handed to workers via INIT_MEMORY — undefined on
   * message-only pools. Useful for passing the same buffer to auxiliaries
   * (e.g. a second pool of HTTP workers via withSharedBuffer).
   */
  public get sharedBuffer(): SharedArrayBuffer | undefined {
    return this.memoryManager?.getBuffer();
  }

  /**
   * Live snapshot of the pool's worker slots — for auxiliary messaging that
   * isn't task dispatch (e.g. routing accepted sockets into workers). The
   * array is a copy; respawned workers appear on the next read. Do NOT use
   * this to dispatch tasks — runTask/dispatch own the scheduling protocol.
   */
  public get workers(): readonly Worker[] {
    return this.slots.map((s) => s.worker);
  }

  /** Running aggregates — no histograms, just counts and means. */
  public stats(): PoolStats {
    return {
      workers: this.slots.length,
      idle: this.slots.filter((s) => s.inFlight === 0).length,
      inFlight: this.pending.size,
      queued: this.queue.length,
      completed: this.statsAgg.completed,
      failed: this.statsAgg.failed,
      aborted: this.statsAgg.aborted,
      waitMs: { count: this.statsAgg.waitMs.count, mean: this.statsAgg.waitMs.mean, max: this.statsAgg.waitMs.max },
      runMs: { count: this.statsAgg.runMs.count, mean: this.statsAgg.runMs.mean, max: this.statsAgg.runMs.max },
    };
  }

  /** Resolves once the queue is empty and nothing is in flight, then terminates. */
  public close(): Promise<void> {
    if (this.queue.length === 0 && this.pending.size === 0) {
      this.terminate();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.drainWaiters.push(() => {
        this.terminate();
        resolve();
      });
    });
  }

  public terminate(): void {
    this.closed = true;
    // Final flush + release — fire-and-forget; terminate() stays synchronous.
    void this.persistence?.stop()?.catch?.((e: unknown) =>
      poolLog.warn('memory persistence stop failed', e),
    );
    poolLog.info(`terminating ${this.slots.length} worker(s)`);
    const crashed = new WorkerCrashedError('pool terminated');
    for (const [, entry] of this.pending) {
      this.detach(entry);
      if (entry.done) continue; // orphaned — already counted as aborted
      entry.done = true;
      this.statsAgg.failed++;
      entry.reject(crashed);
    }
    this.pending.clear();
    for (const entry of this.queue.splice(0)) {
      entry.done = true;
      this.detach(entry);
      this.statsAgg.failed++;
      entry.reject(crashed);
    }
    for (const slot of this.slots) {
      slot.worker.terminate();
    }
    this.slots = [];
    this.checkDrained();
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
