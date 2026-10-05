/**
 * Dashboard control over the live runners of this thread: `pool.list`,
 * `pool.stats`, `worker.kill`, `pool.chaos`. Runners (`WorkerPool`,
 * `DedicatedWorker`) register here from their constructor only when
 * `devtoolsEnabled()`, and unregister on terminate — with devtools off
 * nothing is registered and the runners' only cost is one `chaos` field
 * check per dispatch.
 *
 * Scope: one registry per thread. Pools spawned inside workers (sub-pools,
 * nested island clients) register in the worker's own registry, which the
 * dashboard's control channel (main thread only) cannot reach.
 */
import { registerDevtoolsCommand } from '../devtools';
import type { PoolStats } from './workerPool';

/** Fault injection applied at dispatch. All rates are probabilities in 0..1. */
export interface ChaosConfig {
  /** Delay before the call is posted to the worker. */
  delayMs?: number;
  /** Share of calls rejected with `CHAOS_FAILURE` (settle outcome 'error'). */
  failRate?: number;
  /** Share of calls failed through the timeout path (settle outcome 'timeout'). */
  timeoutRate?: number;
}

/** Error message of a chaos-injected failure. */
export const CHAOS_FAILURE = 'chaos: injected failure';
/** Crash message of a dashboard `worker.kill`. */
export const KILL_MESSAGE = 'killed from devtools';

/** What a runner exposes to the dashboard commands. */
export interface DevtoolsRunnerHandle {
  poolId: string;
  label?: string;
  dedicated: boolean;
  /** Live worker count. */
  size(): number;
  stats(): PoolStats;
  /** Run the runner's real crash handler for that slot (throws on a bad slot). */
  kill(slot: number): void;
  getChaos(): ChaosConfig | null;
  setChaos(chaos: ChaosConfig | null): void;
}

const runners = new Map<string, DevtoolsRunnerHandle>();
let uninstall: (() => void) | null = null;

const runnerOf = (args: Record<string, unknown>): DevtoolsRunnerHandle => {
  const id = args.poolId;
  if (typeof id !== 'string') throw new Error('poolId (string) is required');
  const r = runners.get(id);
  if (!r) {
    throw new Error(
      id.includes('~')
        ? `runner '${id}' lives inside a worker: nested pools are not controllable from the dashboard`
        : `no live runner '${id}' on this thread`,
    );
  }
  return r;
};

const rate = (v: unknown, name: string): number | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
    throw new Error(`${name} must be a number in 0..1`);
  }
  return v || undefined;
};

/** Validate `pool.chaos` args into a config; null when nothing is active (clears). */
export const parseChaos = (args: Record<string, unknown>): ChaosConfig | null => {
  const { delayMs } = args;
  if (delayMs !== undefined && delayMs !== null && (typeof delayMs !== 'number' || !Number.isFinite(delayMs) || delayMs < 0)) {
    throw new Error('delayMs must be a non-negative number');
  }
  const failRate = rate(args.failRate, 'failRate');
  const timeoutRate = rate(args.timeoutRate, 'timeoutRate');
  if ((failRate ?? 0) + (timeoutRate ?? 0) > 1) throw new Error('failRate + timeoutRate must not exceed 1');
  const chaos: ChaosConfig = {};
  if (delayMs) chaos.delayMs = delayMs as number;
  if (failRate) chaos.failRate = failRate;
  if (timeoutRate) chaos.timeoutRate = timeoutRate;
  return Object.keys(chaos).length ? chaos : null;
};

const listRunners = () =>
  [...runners.values()].map((r) => ({
    poolId: r.poolId,
    label: r.label ?? r.poolId,
    size: r.size(),
    dedicated: r.dedicated,
    chaos: r.getChaos(),
  }));

const install = (): (() => void) => {
  const offs = [
    registerDevtoolsCommand('pool.list', () => listRunners()),
    registerDevtoolsCommand('pool.stats', (args) => runnerOf(args).stats()),
    registerDevtoolsCommand('worker.kill', (args) => {
      const r = runnerOf(args);
      const slot = args.slot ?? 0;
      if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0) {
        throw new Error('slot must be a non-negative integer');
      }
      r.kill(slot);
      return { poolId: r.poolId, slot, killed: true };
    }),
    registerDevtoolsCommand('pool.chaos', (args) => {
      const r = runnerOf(args);
      r.setChaos(parseChaos(args));
      return r.getChaos();
    }),
  ];
  return () => offs.forEach((off) => off());
};

/**
 * Register a live runner; returns its unregister. The pool commands are
 * installed with the first runner and removed with the last, so the
 * dashboard's `devtools.commands` only advertises them while there is
 * something to control.
 */
export const registerDevtoolsRunner = (handle: DevtoolsRunnerHandle): (() => void) => {
  runners.set(handle.poolId, handle);
  uninstall ??= install();
  return () => {
    if (runners.get(handle.poolId) !== handle) return;
    runners.delete(handle.poolId);
    if (runners.size === 0 && uninstall) {
      uninstall();
      uninstall = null;
    }
  };
};

/** Hooks a runner supplies to `applyChaos` for one dispatched call. */
export interface ChaosCall {
  /** Still awaiting its reply (not crashed/terminated away during the delay). */
  live(): boolean;
  /** Settle as a worker-reported failure (the runner's reply path). */
  fail(): void;
  /** Settle through the runner's timeout path. */
  timeout(): void;
  /** Post the call to the worker. */
  post(): void;
}

/**
 * Apply an active chaos config to one dispatched call. An injected failure
 * never reaches the worker; an injected timeout settles the caller through
 * the timeout path and still posts the call, exactly like a real timeout
 * (the worker runs it; its late reply frees the slot and is discarded).
 */
export const applyChaos = (chaos: ChaosConfig, call: ChaosCall): void => {
  const r = Math.random();
  const fail = r < (chaos.failRate ?? 0);
  const timeout = !fail && r < (chaos.failRate ?? 0) + (chaos.timeoutRate ?? 0);
  if (!chaos.delayMs && !fail && !timeout) return call.post();
  setTimeout(() => {
    if (!call.live()) return;
    if (fail) return call.fail();
    if (timeout) call.timeout();
    call.post();
  }, chaos.delayMs ?? 0);
};
