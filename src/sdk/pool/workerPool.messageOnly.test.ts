// @vitest-environment node
/**
 * Opt-in shared memory: with `sharedMemory` omitted the pool must not touch
 * SharedArrayBuffer/crossOriginIsolated, sends `{ type: 'INIT' }`, and tasks
 * still round-trip.
 */
import { describe, expect, it, vi } from 'vitest';
import { WorkerPool } from './workerPool';
import { TaskRegistry } from '../worker/registry';
import { InProcessWorker } from '../../../test/inProcessWorker';

vi.stubGlobal('Worker', InProcessWorker);
vi.stubGlobal('crossOriginIsolated', false);
vi.stubGlobal('SharedArrayBuffer', undefined);

describe('workerPool — message-only (no sharedMemory)', () => {
  it('constructs without SharedArrayBuffer and sends INIT', async () => {
    InProcessWorker.created = [];
    TaskRegistry.register({ taskId: 'greet' }, (name: string) => `hi ${name}`);

    const sent = vi.spyOn(InProcessWorker.prototype, 'postMessage');
    const p = new WorkerPool({
      poolSize: 1,
      createWorker: () => new Worker(new URL('./x.worker.ts', import.meta.url)),
    });
    expect((p as { sharedMemory?: unknown }).sharedMemory).toBeUndefined();
    expect(InProcessWorker.created).toHaveLength(1);
    expect(sent).toHaveBeenCalledWith({ type: 'INIT' });
    await expect(p.runTask({ taskId: 'greet' }, 'mesh')).resolves.toBe('hi mesh');
    p.terminate();
  });
});
