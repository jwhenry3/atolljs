/**
 * Worker side of the devtools batch, through the real bootstrap: once the
 * INIT handshake enables forwarding, `log()` entries ride ATOLL_DEVTOOLS
 * messages to the pool, and each task run gets an `atoll run` measure.
 * Own file: forwarding installs a module-global sink for the rest of it.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';

describe('workerBootstrap devtools', () => {
  const posted: any[] = [];
  const fakeSelf = { postMessage: (m: unknown) => posted.push(m), onmessage: null as any, performance };
  vi.stubGlobal('self', fakeSelf);
  afterAll(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('forwards worker logs and measures task runs once INIT enables devtools', async () => {
    const { installWorkerListener } = await import('./workerBootstrap');
    const { TaskRegistry } = await import('./registry');
    installWorkerListener();
    TaskRegistry.register({ taskId: 'wb-echo' }, async (x: number) => x * 2);
    const measure = vi.spyOn(performance, 'measure');

    await fakeSelf.onmessage({ data: { type: 'INIT', devtools: true } });
    const logs = posted.filter((m) => m.type === 'ATOLL_DEVTOOLS' && m.event.type === 'log');
    expect(logs[0].event).toMatchObject({ type: 'log', level: 'info', scope: 'worker' });
    expect(logs[0].event.message).toMatch(/initialized/);

    await fakeSelf.onmessage({ data: { type: 'EXECUTE_TASK', messageId: 7, taskId: 'wb-echo', args: [21] } });
    expect(posted).toContainEqual({ messageId: 7, success: true, result: 42 });
    const run = measure.mock.calls.find(([name]) => name === 'atoll run wb-echo');
    expect(run).toBeDefined();
    expect((run![1] as any).detail.devtools).toMatchObject({ track: 'tasks', trackGroup: 'atoll', color: 'secondary' });
  });
});
