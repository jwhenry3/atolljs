import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { TaskRegistry } from './registry';
import { TaskContract } from '../contract/types';

const contract = <A extends any[], R>(c: Partial<TaskContract<A, R>> & { taskId: string }): TaskContract<A, R> => c;

describe('TaskRegistry', () => {
  it('executes a registered handler with typed args', async () => {
    TaskRegistry.register(contract<[n: number], number>({ taskId: 't-double' }), (n) => n * 2);
    await expect(TaskRegistry.execute('t-double', 21)).resolves.toBe(42);
  });

  it('supports async handlers', async () => {
    TaskRegistry.register(contract<[], string>({ taskId: 't-async' }), async () => 'ok');
    await expect(TaskRegistry.execute('t-async')).resolves.toBe('ok');
  });

  it('throws for unknown task ids', async () => {
    await expect(TaskRegistry.execute('t-missing')).rejects.toThrow(/not found/);
  });

  it('exposes the registered contract', () => {
    const c = contract<[], void>({ taskId: 't-contract' });
    TaskRegistry.register(c, () => undefined);
    expect(TaskRegistry.getContract('t-contract')).toBe(c);
    expect(TaskRegistry.getContract('t-none')).toBeUndefined();
  });

  it('rejects args that fail argsSchema', async () => {
    TaskRegistry.register(
      contract<[n: number], number>({ taskId: 't-args', argsSchema: z.tuple([z.number()]) }),
      (n) => n
    );
    await expect(TaskRegistry.execute('t-args', 'not-a-number')).rejects.toThrow();
  });

  it('rejects results that fail resultSchema', async () => {
    TaskRegistry.register(
      contract<[], number>({ taskId: 't-result', resultSchema: z.number() }),
      () => 'oops' as any
    );
    await expect(TaskRegistry.execute('t-result')).rejects.toThrow();
  });

  it('lets a later registration replace an earlier one', async () => {
    const c = contract<[], number>({ taskId: 't-replace' });
    TaskRegistry.register(c, () => 1);
    TaskRegistry.register(c, () => 2);
    await expect(TaskRegistry.execute('t-replace')).resolves.toBe(2);
  });
});
