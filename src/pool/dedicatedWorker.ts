import type { MemoryManager } from './memory';
import { TaskAbortedError, TaskTimeoutError, WorkerCrashedError } from './errors';
import type { SharedAccess, SharedMemory, SharedSpec } from '../contract/sharedMemory';
import type { MemoryPersistence, TaskContract, TaskMap, TaskResult, WorkerPoolConfig } from '../contract/types';
import { devtoolsEnabled, emitDevtools, estimateCloneBytes, nextDevtoolsId, type EmittedDevtoolsEvent } from '../devtools';
import { fmtBytes, scoped } from '../log';
import { measureTaskCall } from '../userTiming';
import type { PoolStats, RunOptions } from './workerPool';
import { forwardWorkerDevtools, sendInit, setupChannelMemory, type ChannelMemory } from './workerChannel';
import { applyChaos, CHAOS_FAILURE, KILL_MESSAGE, registerDevtoolsRunner, type ChaosConfig } from './devtoolsCommands';

const workerLog = scoped('worker');
const taskLog = scoped('task');

/**
 * Config for a single dedicated worker: the WorkerPool config minus the
 * pool-only knobs (size, per-worker concurrency cap, queue bound, task
 * methods). Every call posts straight to the worker.
 */
export type DedicatedWorkerConfig<S extends SharedSpec = SharedSpec> = Omit<
  WorkerPoolConfig<S, TaskMap>,
  'poolSize' | 'concurrency' | 'maxQueue' | 'tasks'
>;

interface Call {
  contract: TaskContract<any[], any>;
  callId: number;
  sentAt: number;
  resolve: (v: any) => void;
  reject: (e: unknown) => void;
  /** Settled (or orphaned by abort/timeout): a late reply is discarded. */
  done: boolean;
  timer?: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onSignalAbort?: () => void;
}

const agg = () => ({
  count: 0,
  mean: 0,
  max: 0,
  add(v: number) {
    this.count++;
    this.mean += (v - this.mean) / this.count;
    if (v > this.max) this.max = v;
  },
});

/**
 * One worker, no pool: what `connectWorker({ workers: 1 })` (the default)
 * builds. Calls are posted to the worker immediately, with no queue and no
 * scheduler; the worker's own message loop runs them in arrival order (a
 * task that awaits lets the next message start, exactly as in a pool slot
 * with a raised concurrency cap). Kept from the pool: per-call
 * timeout/abort, crash respawn, `stats()`, and the same devtools events,
 * with `pool:init` flagged `dedicated: true`.
 */
export class DedicatedWorker<S extends SharedSpec = SharedSpec> {
  /**
   * Devtools correlation id: '<name>-w' when the config has a `name`, else
   * 'worker-N'. The same role a pool's id plays.
   */
  readonly poolId: string;
  readonly sharedMemory: (SharedMemory<S> & SharedAccess<S>) | undefined;
  readonly persistence: MemoryPersistence | undefined;
  private readonly mem: ChannelMemory<S>;
  private readonly spawn: () => Worker;
  private readonly respawn: boolean;
  private readonly taskTimeout?: number;
  private readonly label?: string;
  private worker: Worker | null = null;
  private pending = new Map<number, Call>();
  private nextMessageId = 0;
  private nextCallId = 0;
  private closed = false;
  /** Dashboard fault injection (`pool.chaos`); null unless devtools set it. */
  private chaos: ChaosConfig | null = null;
  private devtoolsOff?: () => void;
  private drainWaiters: Array<() => void> = [];
  private statsAgg = { completed: 0, failed: 0, aborted: 0, runMs: agg() };

  constructor(config: DedicatedWorkerConfig<S>) {
    this.mem = setupChannelMemory(config, 'DedicatedWorker');
    if (!config.workerUrl && !config.createWorker) {
      throw new Error('DedicatedWorker requires either `workerUrl` or `createWorker` in its config.');
    }
    const url = config.workerUrl;
    this.spawn = config.createWorker ?? (() => new Worker(url!, { type: 'module' }));
    this.respawn = config.respawn ?? true;
    this.taskTimeout = config.taskTimeout;
    this.label = config.name;
    this.poolId = nextDevtoolsId('worker', config.name);
    this.sharedMemory = this.mem.sharedMemory;
    this.persistence = this.mem.persistence;

    const bytes = this.mem.sharedMemory?.totalBytes ?? this.mem.injectedBuffer?.byteLength;
    workerLog.info(
      bytes !== undefined ? `spawning 1 dedicated worker with ${fmtBytes(bytes)} shared buffer` : 'spawning 1 dedicated worker, message-only',
    );
    emitDevtools({
      type: 'pool:init',
      poolId: this.poolId,
      label: this.label,
      poolSize: 1,
      concurrency: 0,
      memoryBytes: bytes,
      dedicated: true,
    });
    this.attach(this.spawn());
    if (devtoolsEnabled()) {
      this.devtoolsOff = registerDevtoolsRunner({
        poolId: this.poolId,
        label: this.label,
        dedicated: true,
        size: () => (this.worker ? 1 : 0),
        stats: () => this.stats(),
        kill: (slot) => {
          if (slot !== 0 || !this.worker) throw new Error(`${this.poolId} has no live worker at slot ${slot}`);
          this.handleError({ message: KILL_MESSAGE });
        },
        getChaos: () => this.chaos,
        setChaos: (chaos) => { this.chaos = chaos; },
      });
    }
  }

  private attach(worker: Worker): void {
    this.worker = worker;
    worker.addEventListener('message', (event: MessageEvent) => {
      if (this.worker !== worker) return;
      const data = event.data as TaskResult & { messageId?: number; type?: string; event?: EmittedDevtoolsEvent };
      if (data.type === 'ATOLL_DEVTOOLS' && data.event) {
        forwardWorkerDevtools(this.poolId, 0, data.event);
        return;
      }
      this.handleReply(data);
    });
    worker.addEventListener('error', (event: unknown) => {
      if (this.worker === worker) this.handleError(event);
    });
    const init = sendInit(worker, this.mem);
    workerLog.debug(`dedicated worker spawned, ${init} sent`);
    emitDevtools({ type: 'worker:spawn', poolId: this.poolId, slot: 0 });
  }

  private detach(call: Call): void {
    if (call.timer) clearTimeout(call.timer);
    if (call.signal && call.onSignalAbort) call.signal.removeEventListener('abort', call.onSignalAbort);
  }

  private handleReply(data: TaskResult & { messageId?: number }): void {
    const call = data.messageId !== undefined ? this.pending.get(data.messageId) : undefined;
    if (!call) return;
    this.pending.delete(data.messageId!);
    this.detach(call);
    if (!call.done) {
      call.done = true;
      const runMs = performance.now() - call.sentAt;
      this.statsAgg.runMs.add(runMs);
      if (data.success) {
        this.statsAgg.completed++;
        taskLog.debug(`← ${call.contract.taskId} ok`);
        if (devtoolsEnabled()) {
          emitDevtools({ type: 'task:settle', poolId: this.poolId, callId: call.callId, taskId: call.contract.taskId, outcome: 'ok', runMs, resultBytes: estimateCloneBytes(data.result) });
          measureTaskCall(this.poolId, call.contract.taskId, call.callId, 0, call.sentAt, call.sentAt + runMs, true);
        }
        call.resolve(data.result);
      } else {
        this.statsAgg.failed++;
        taskLog.warn(`← ${call.contract.taskId} failed: ${data.error}`);
        if (devtoolsEnabled()) {
          emitDevtools({ type: 'task:settle', poolId: this.poolId, callId: call.callId, taskId: call.contract.taskId, outcome: 'error', runMs, error: data.error });
          measureTaskCall(this.poolId, call.contract.taskId, call.callId, 0, call.sentAt, call.sentAt + runMs, false);
        }
        call.reject(new Error(data.error));
      }
    }
    this.checkDrained();
  }

  private handleError(event: unknown): void {
    if (this.closed) return;
    const e = event as { message?: string; error?: Error } | undefined;
    const message = e?.message ?? (e?.error ? String(e.error) : 'worker error');
    workerLog.warn(`worker error: ${message}`);
    emitDevtools({ type: 'worker:error', poolId: this.poolId, slot: 0, message });
    this.rejectPending(message);
    this.worker?.terminate();
    this.worker = null;
    if (this.respawn) {
      workerLog.info('respawning crashed worker');
      this.attach(this.spawn());
      emitDevtools({ type: 'worker:respawn', poolId: this.poolId, slot: 0 });
    }
    this.checkDrained();
  }

  private rejectPending(message: string): void {
    const err = new WorkerCrashedError(message);
    for (const call of this.pending.values()) {
      this.detach(call);
      if (call.done) continue;
      call.done = true;
      this.statsAgg.failed++;
      emitDevtools({ type: 'task:settle', poolId: this.poolId, callId: call.callId, taskId: call.contract.taskId, outcome: 'crashed', error: message });
      call.reject(err);
    }
    this.pending.clear();
  }

  /** Abort/timeout: the caller rejects now; the worker's eventual reply is discarded. */
  private cancel(call: Call, err: Error): void {
    if (call.done) return;
    call.done = true;
    this.detach(call);
    this.statsAgg.aborted++;
    emitDevtools({ type: 'task:settle', poolId: this.poolId, callId: call.callId, taskId: call.contract.taskId, outcome: err instanceof TaskTimeoutError ? 'timeout' : 'aborted' });
    call.reject(err);
  }

  private checkDrained(): void {
    if (this.pending.size > 0) return;
    for (const w of this.drainWaiters.splice(0)) w();
  }

  /** Post the call straight to the worker — no queue, no scheduler. */
  public dispatch<Args extends any[], Result>(
    contract: TaskContract<Args, Result>,
    args: Args,
    options?: RunOptions,
  ): Promise<Result> {
    const worker = this.worker;
    if (this.closed || worker === null) {
      return Promise.reject(new WorkerCrashedError('DedicatedWorker has been terminated — no worker available.'));
    }
    if (options?.signal?.aborted) return Promise.reject(new TaskAbortedError());
    return new Promise<Result>((resolve, reject) => {
      const call: Call = {
        contract,
        callId: ++this.nextCallId,
        sentAt: performance.now(),
        resolve,
        reject,
        done: false,
        signal: options?.signal,
      };
      if (options?.signal) {
        call.onSignalAbort = () => this.cancel(call, new TaskAbortedError());
        options.signal.addEventListener('abort', call.onSignalAbort, { once: true });
      }
      const timeout = options?.timeout ?? this.taskTimeout;
      if (timeout !== undefined) call.timer = setTimeout(() => this.cancel(call, new TaskTimeoutError()), timeout);

      const messageId = this.nextMessageId++;
      this.pending.set(messageId, call);
      taskLog.debug(`→ ${contract.taskId}`, { args });
      emitDevtools({ type: 'task:enqueue', poolId: this.poolId, callId: call.callId, taskId: contract.taskId });
      if (devtoolsEnabled()) {
        emitDevtools({ type: 'task:dispatch', poolId: this.poolId, callId: call.callId, taskId: contract.taskId, slot: 0, waitMs: 0, argBytes: estimateCloneBytes(args) });
      }
      const msg = { type: 'EXECUTE_TASK', messageId, taskId: contract.taskId, args };
      if (this.chaos) {
        applyChaos(this.chaos, {
          live: () => this.pending.get(messageId) === call,
          fail: () => this.handleReply({ messageId, taskId: contract.taskId, success: false, error: CHAOS_FAILURE }),
          timeout: () => this.cancel(call, new TaskTimeoutError()),
          post: () => worker.postMessage(msg),
        });
      } else {
        worker.postMessage(msg);
      }
    });
  }

  public runTask<Args extends any[], Result>(contract: TaskContract<Args, Result>, ...args: Args): Promise<Result> {
    return this.dispatch(contract, args);
  }

  /** The shared buffer handed to the worker via INIT_MEMORY; undefined when message-only. */
  public get sharedBuffer(): SharedArrayBuffer | undefined {
    return (this.mem.memoryManager as MemoryManager | undefined)?.getBuffer() ?? this.mem.injectedBuffer;
  }

  /** The worker, as a one-element snapshot (same shape as `WorkerPool.workers`). */
  public get workers(): readonly Worker[] {
    return this.worker ? [this.worker] : [];
  }

  /** Same shape as `WorkerPool.stats()`; `queued` and `waitMs` stay zero (there is no queue). */
  public stats(): PoolStats {
    const live = this.worker ? 1 : 0;
    const { runMs } = this.statsAgg;
    return {
      workers: live,
      idle: live && this.pending.size === 0 ? 1 : 0,
      inFlight: this.pending.size,
      queued: 0,
      completed: this.statsAgg.completed,
      failed: this.statsAgg.failed,
      aborted: this.statsAgg.aborted,
      waitMs: { count: 0, mean: 0, max: 0 },
      runMs: { count: runMs.count, mean: runMs.mean, max: runMs.max },
    };
  }

  /** Resolves once nothing is in flight, then terminates. */
  public close(): Promise<void> {
    if (this.pending.size === 0) {
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
    if (this.closed) return;
    this.closed = true;
    this.devtoolsOff?.();
    void this.persistence?.stop()?.catch?.((e: unknown) => workerLog.warn('memory persistence stop failed', e));
    workerLog.info('terminating dedicated worker');
    emitDevtools({ type: 'pool:terminate', poolId: this.poolId });
    this.rejectPending('worker terminated');
    this.worker?.terminate();
    this.worker = null;
    this.checkDrained();
  }
}
