import { scoped } from './log';
import type { ObservableValue } from './observable';

const taskLog = scoped('task');

/**
 * Point-in-time state of an {@link AsyncTask}. Replaced wholesale on every
 * transition so `get()` stays stable for `useSyncExternalStore`-style
 * adapters.
 */
export interface TaskSnapshot<R> {
  /** Result of the last completed run; kept while a newer run is in flight. */
  data: R | null;
  pending: boolean;
  /** True once any run has completed (success or failure). */
  settled: boolean;
  /** Wall-clock duration of the last completed run. */
  elapsedMs: number | null;
  error: unknown;
}

/**
 * An async function turned into a subscribable task: `run` starts an
 * invocation, and concurrent runs are latest-wins — a stale result is
 * discarded rather than applied. Framework bindings subscribe to the
 * snapshot; callers trigger `run`.
 */
export interface AsyncTask<A, R> extends ObservableValue<TaskSnapshot<R>> {
  run(input: A): void;
  /** No-op if a run is pending or has already settled — for init-style tasks. */
  runOnce(input: A): void;
}

export function defineTask<A, R>(fn: (input: A) => Promise<R>): AsyncTask<A, R> {
  let reqId = 0;
  let snapshot: TaskSnapshot<R> = { data: null, pending: false, settled: false, elapsedMs: null, error: null };
  const subscribers = new Set<(s: TaskSnapshot<R>) => void>();
  const emit = (next: TaskSnapshot<R>) => {
    snapshot = next;
    for (const cb of subscribers) cb(next);
  };

  const task: AsyncTask<A, R> = {
    get: () => snapshot,
    subscribe(onChange) {
      subscribers.add(onChange);
      return () => {
        subscribers.delete(onChange);
      };
    },
    run(input: A) {
      const id = ++reqId;
      const t0 = performance.now();
      emit({ ...snapshot, pending: true, error: null });
      void fn(input).then(
        (data) => {
          if (id === reqId) emit({ data, pending: false, settled: true, elapsedMs: performance.now() - t0, error: null });
        },
        (error) => {
          if (id === reqId) emit({ ...snapshot, pending: false, settled: true, error });
          taskLog.error('task run failed', error);
        }
      );
    },
    runOnce(input: A) {
      if (snapshot.pending || snapshot.settled) return;
      task.run(input);
    },
  };
  return task;
}
