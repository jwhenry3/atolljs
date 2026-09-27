import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createClient,
  defineService,
  implementService,
  rpc,
  type TaskRunner,
} from './service';
import { TaskRegistry } from './worker/registry';

const echo = defineService('echo', {
  ping: rpc<[], string>(),
  add: rpc<[a: number, b: number], number>({
    argsSchema: z.tuple([z.number(), z.number()]),
    resultSchema: z.number(),
  }),
});

describe('defineService', () => {
  it('derives wire ids as service.method', () => {
    expect(echo.name).toBe('echo');
    expect(echo.tasks.ping.taskId).toBe('echo.ping');
    expect(echo.tasks.add.taskId).toBe('echo.add');
  });

  it('carries schemas onto the resolved contracts', () => {
    expect(echo.tasks.ping.argsSchema).toBeUndefined();
    expect(echo.tasks.add.argsSchema).toBeDefined();
    expect(() => echo.tasks.add.argsSchema!.parse([1, 2])).not.toThrow();
    expect(() => echo.tasks.add.argsSchema!.parse(['x'])).toThrow();
  });

  it('honors an explicit taskId override', () => {
    const svc = defineService('legacy', {
      old: rpc<[], number>({ taskId: 'pre-existing-id' }),
    });
    expect(svc.tasks.old.taskId).toBe('pre-existing-id');
  });
});

describe('implementService', () => {
  it('registers handlers executable through TaskRegistry', async () => {
    implementService(echo, {
      ping: () => 'pong',
      add: (a, b) => a + b,
    });
    await expect(TaskRegistry.execute('echo.ping')).resolves.toBe('pong');
    await expect(TaskRegistry.execute('echo.add', 2, 3)).resolves.toBe(5);
  });

  it('throws at bind time when a method handler is missing', () => {
    expect(() =>
      implementService(
        echo,
        { ping: () => 'pong' } as never,
      ),
    ).toThrow(/missing handlers.*add/);
  });

  it('binds handlers to the handlers object so siblings are reachable via this', async () => {
    const svc = defineService('self-call', {
      outer: rpc<[], string>(),
      inner: rpc<[], string>(),
    });
    implementService(svc, {
      outer() {
        return `outer→${(this as { inner(): string }).inner()}`;
      },
      inner: () => 'inner',
    });
    await expect(TaskRegistry.execute('self-call.outer')).resolves.toBe('outer→inner');
  });

  it('runs schemas on args in and results out', async () => {
    implementService(echo, {
      ping: () => 'pong',
      add: (a, b) => a + b,
    });
    await expect(
      TaskRegistry.execute('echo.add', 'bad', 1),
    ).rejects.toThrow();
    // Registry re-registering is allowed — last write wins.
    implementService(echo, {
      ping: () => 'pong',
      add: () => 'oops' as unknown as number,
    });
    await expect(TaskRegistry.execute('echo.add', 1, 1)).rejects.toThrow();
  });
});

describe('createClient', () => {
  it('dispatches each method through the runner with its contract', async () => {
    const calls: { taskId: string; args: unknown[] }[] = [];
    const runner: TaskRunner = {
      runTask: vi.fn(async (contract, ...args: unknown[]) => {
        calls.push({ taskId: contract.taskId, args });
        return `${contract.taskId}:ok` as never;
      }),
    };
    const client = createClient(echo, runner);

    await expect(client.ping()).resolves.toBe('echo.ping:ok');
    await client.add(1, 2);
    expect(calls).toEqual([
      { taskId: 'echo.ping', args: [] },
      { taskId: 'echo.add', args: [1, 2] },
    ]);
  });

  it('propagates runner rejections', async () => {
    const runner: TaskRunner = {
      runTask: () => Promise.reject(new Error('worker exploded')),
    };
    await expect(createClient(echo, runner).ping()).rejects.toThrow('worker exploded');
  });
});
