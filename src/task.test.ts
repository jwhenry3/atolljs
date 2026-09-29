import { describe, expect, it, vi } from 'vitest';
import { defineTask, isAsyncTask, toTask } from './task';

const deferred = <T>() => {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('defineTask', () => {
  it('starts in an idle, unsettled snapshot', () => {
    const task = defineTask(async (n: number) => n);
    expect(task.get()).toEqual({ data: null, pending: false, settled: false, elapsedMs: null, error: null });
  });

  it('transitions pending → settled with data and elapsedMs', async () => {
    const task = defineTask(async (n: number) => n * 2);
    const seen: boolean[] = [];
    task.subscribe((s) => seen.push(s.pending));

    task.run(21);
    expect(task.get().pending).toBe(true);
    await tick();

    const s = task.get();
    expect(s).toMatchObject({ data: 42, pending: false, settled: true, error: null });
    expect(s.elapsedMs).toBeTypeOf('number');
    expect(seen).toEqual([true, false]);
  });

  it('keeps prior data on a failed run and reports the error', async () => {
    let fail = false;
    const task = defineTask(async () => {
      if (fail) throw new Error('nope');
      return 'good';
    });
    task.run(undefined);
    await tick();

    fail = true;
    task.run(undefined);
    await tick();

    const s = task.get();
    expect(s.error).toBeInstanceOf(Error);
    expect(s.settled).toBe(true);
    expect(s.data).toBe('good'); // last successful result survives a failed run
  });

  it('is latest-wins: a stale in-flight result is discarded', async () => {
    const calls: Array<ReturnType<typeof deferred<string>>> = [];
    const task = defineTask((input: string) => {
      const d = deferred<string>();
      calls.push(d);
      return d.promise;
    });

    task.run('first');
    task.run('second');
    calls[1].resolve('B');
    calls[0].resolve('A'); // resolves late — must be dropped
    await tick();

    expect(task.get().data).toBe('B');
  });

  it('runOnce ignores calls while pending or after settling', async () => {
    const fn = vi.fn(async () => 'done');
    const task = defineTask(fn);

    task.runOnce(undefined);
    task.runOnce(undefined); // pending — ignored
    await tick();
    task.runOnce(undefined); // settled — ignored
    task.run(undefined);     // explicit run still works
    await tick();

    expect(fn).toHaveBeenCalledTimes(2);
    expect(task.get().data).toBe('done');
  });

  it('unsubscribe stops notifications', async () => {
    const task = defineTask(async () => 1);
    const spy = vi.fn();
    const off = task.subscribe(spy);
    off();
    task.run(undefined);
    await tick();
    expect(spy).not.toHaveBeenCalled();
  });

  it('ignores a result from a superseded run', async () => {
    const d1 = deferred<number>();
    const d2 = deferred<number>();
    const calls: number[] = [];
    const task = defineTask((n: number) => {
      calls.push(n);
      return calls.length === 1 ? d1.promise : d2.promise;
    });
    task.run(1);
    task.run(2); // supersedes run 1

    d2.resolve(20);
    await tick();
    d1.resolve(10); // late — must not overwrite run 2's data
    await tick();
    expect(task.get().data).toBe(20);
  });

  it('ignores a rejection from a superseded run', async () => {
    const d1 = deferred<number>();
    const d2 = deferred<number>();
    let calls = 0;
    const task = defineTask(() => (++calls === 1 ? d1.promise : d2.promise));
    task.run(1);
    task.run(2);

    d1.reject(new Error('stale failure')); // must not clobber the pending run
    d2.resolve(20);
    await tick();
    expect(task.get()).toMatchObject({ data: 20, error: null });
  });
});

describe('isAsyncTask / toTask', () => {
  it('detects tasks structurally', () => {
    expect(isAsyncTask(defineTask(async () => 1))).toBe(true);
    expect(isAsyncTask(async () => 1)).toBe(false);
    expect(isAsyncTask(null)).toBe(false);
    expect(isAsyncTask({ run: () => {} })).toBe(false);
  });

  it('returns a task source unchanged', () => {
    const task = defineTask(async (n: number) => n);
    expect(toTask(task)).toBe(task);
  });

  it('wraps a plain async fn into a working task', async () => {
    const task = toTask(async (n: number) => n * 3);
    task.run(4);
    await vi.waitFor(() => expect(task.get().settled).toBe(true));
    expect(task.get().data).toBe(12);
  });

  it('wraps a no-arg async fn as AsyncTask<void, R>', async () => {
    const task = toTask(async () => 'ready');
    task.runOnce();
    await vi.waitFor(() => expect(task.get().data).toBe('ready'));
  });
});
