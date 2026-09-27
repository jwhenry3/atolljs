import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createClient,
  defineService,
  implementService,
  rpc,
  serviceMethod,
  type TaskRunner,
} from './service';
import { TaskRegistry } from './worker/registry';

const echo = defineService('echo', {
  ping: rpc<[], string>(), // no schemas — rpc() carries the signature
  add: {
    argsSchema: z.tuple([z.number(), z.number()]),
    resultSchema: z.number(),
  }, // types infer straight from the schemas — no rpc() needed
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

  it('infers handler signatures from schemas — wrong types fail compile', () => {
    implementService(echo, {
      ping: () => 'pong',
      // @ts-expect-error — add's schema pins args to [number, number]
      add: (a: string, b: number) => 0,
    });
    implementService(defineService('ret', { n: { resultSchema: z.number() } }), {
      // @ts-expect-error — resultSchema pins the return type to number
      n: () => 'not a number',
    });
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

describe('ServiceMethod units', () => {
  // The one-file-per-task pattern: serviceMethod() builds the unit — the
  // def's schemas supply the signature, defineService unwraps `.def`,
  // implementService `.run`.
  const greet = serviceMethod({
    def: {
      argsSchema: z.tuple([z.string()]),
      resultSchema: z.string(),
    },
    // Units may carry extra fields for `run`'s `this` — annotate `this` to
    // see them (the factory can't reflect extras back into the signature).
    run(this: { prefix: string }, name) {
      return `hi ${name} (${this.prefix})`;
    },
    prefix: 'unit',
  });

  const svc = defineService('greeter', { greet });

  it('defineService accepts units and unwraps their def', async () => {
    expect(svc.tasks.greet.taskId).toBe('greeter.greet');
    expect(() => svc.tasks.greet.argsSchema!.parse(['ada'])).not.toThrow();
    implementService(svc, { greet });
    await expect(TaskRegistry.execute('greeter.greet', 'ada')).resolves.toBe('hi ada (unit)');
  });

  it('implementService binds a unit’s run to the unit itself', async () => {
    // `this.prefix` above resolved — the unit (not the handlers map) is `this`.
    await expect(TaskRegistry.execute('greeter.greet', 'ada')).resolves.toContain('unit');
  });

  it('unit defs infer handler signatures — wrong types fail compile', () => {
    implementService(svc, {
      // @ts-expect-error — greet's args pin [string]
      greet: { run: (n: number) => 'x' },
    });
  });

  it('serviceMethod derives run’s signature from the def’s schemas', async () => {
    const doubling = serviceMethod({
      def: {
        argsSchema: z.tuple([z.number()]),
        resultSchema: z.number(),
      },
      run(n) {
        // n is contextually `number` from the argsSchema — nothing annotated.
        const scaled: number = n * 2;
        return scaled;
      },
    });
    const svc2 = defineService('math', { doubling });
    implementService(svc2, { doubling });
    await expect(TaskRegistry.execute('math.doubling', 21)).resolves.toBe(42);
  });

  it('serviceMethod accepts rpc<A,R>() defs for schema-less signatures', async () => {
    const pair = serviceMethod({
      def: rpc<[string, number], string>(),
      run(word, times) {
        return word.repeat(times);
      },
    });
    implementService(defineService('rep', { pair }), { pair });
    await expect(TaskRegistry.execute('rep.pair', 'ab', 3)).resolves.toBe('ababab');
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
