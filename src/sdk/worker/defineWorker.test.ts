// Importing defineWorker pulls in workerBootstrap — in a non-worker context
// it logs a warning and skips message wiring; TaskRegistry still works.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineWorker } from './defineWorker';
import { serviceMethod } from '../service';
import { TaskRegistry } from './registry';

describe('defineWorker', () => {
  it('registers flat methods under their own names and executes them', async () => {
    defineWorker({ methods: { ping: () => 'pong' } });
    await expect(TaskRegistry.execute('ping')).resolves.toBe('pong');
  });

  it('registers service methods under `service.method` ids', async () => {
    defineWorker({
      services: { math: { add: (a: number, b: number) => a + b } },
    });
    await expect(TaskRegistry.execute('math.add', 2, 3)).resolves.toBe(5);
  });

  it('enforces a unit\'s arg schema and parses its result', async () => {
    const double = serviceMethod({
      def: { argsSchema: z.tuple([z.number()]), resultSchema: z.number() },
      run: (n) => n * 2,
    });
    defineWorker({ methods: { double } });
    await expect(TaskRegistry.execute('double', 4)).resolves.toBe(8);
    await expect(TaskRegistry.execute('double', 'four')).rejects.toThrow();
  });

  it('binds plain methods to the methods object so `this` reaches siblings', async () => {
    defineWorker({
      methods: {
        base() {
          return 40;
        },
        answer(this: { base(): number }) {
          return this.base() + 2;
        },
      },
    });
    await expect(TaskRegistry.execute('answer')).resolves.toBe(42);
  });

  it('throws at define time on reserved client keys', () => {
    expect(() =>
      defineWorker({
        // @ts-expect-error — 'terminate' collides with the client API
        methods: { terminate: () => {} },
      }),
    ).toThrow(/reserved/);
    expect(() =>
      defineWorker({
        // @ts-expect-error — 'pool' collides with the client API
        services: { pool: { m: () => {} } },
      }),
    ).toThrow(/reserved/);
  });

  it('honors a unit def\'s taskId override', async () => {
    const named = serviceMethod({
      def: { taskId: 'custom.wire-id', resultSchema: z.string() },
      run: () => 'hi',
    });
    defineWorker({ methods: { whatever: named } });
    await expect(TaskRegistry.execute('custom.wire-id')).resolves.toBe('hi');
  });
});
