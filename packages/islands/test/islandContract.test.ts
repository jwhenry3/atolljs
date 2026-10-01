// @vitest-environment happy-dom
/**
 * Island contracts — `defineIslandContract`/`withContract` semantics:
 * name resolution, mount/updateProps props validation, and declared-event
 * payload checks at emit. The fixture worker registers three apps over the
 * same contract machinery: 'checkout' (props + events), 'bademit'
 * (contract-violating emit), 'loose' (unstamped control).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';
import type { Op } from '../src/index';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [() => import('./fixtures/contract.worker')];

let connectIslandWorker: typeof import('../src/index').connectIslandWorker;
let islandAppNameOf: typeof import('../src/index').islandAppNameOf;
let isIslandContract: typeof import('../src/index').isIslandContract;
let contractOf: typeof import('../src/index').contractOf;
let withContract: typeof import('../src/index').withContract;
let checkoutContract: typeof import('./fixtures/contract.worker').checkoutContract;

beforeAll(async () => {
  ({
    connectIslandWorker,
    islandAppNameOf,
    isIslandContract,
    contractOf,
    withContract,
  } = await import('../src/index'));
  ({ checkoutContract } = await import('./fixtures/contract.worker'));
});

const contractWorker = () =>
  new Worker(new URL('./fixtures/contract.worker.ts', import.meta.url), { type: 'module' });

/** The listen op's handler id — the `client.dispatch` target. */
const listenHandler = (ops: Op[]): number => {
  const op = ops.find((o) => o.t === 'listen');
  expect(op).toBeDefined();
  return (op as { handler: number }).handler;
};

describe('defineIslandContract / detection', () => {
  it('isIslandContract recognizes stamped contracts and rejects lookalikes', () => {
    expect(isIslandContract(checkoutContract)).toBe(true);
    expect(isIslandContract({ app: 'checkout', props: {} })).toBe(false);
    expect(isIslandContract('checkout')).toBe(false);
    expect(isIslandContract(null)).toBe(false);
  });

  it('islandAppNameOf resolves a contract to its app key', () => {
    expect(islandAppNameOf(checkoutContract)).toBe('checkout');
    expect(islandAppNameOf({ ...checkoutContract, app: '' })).toBeUndefined();
  });

  it('withContract stamps apps; contractOf reads the stamp', () => {
    const def = { imperative: (): void => {} };
    expect(contractOf(def)).toBeUndefined();
    const stamped = withContract(checkoutContract, def);
    expect(stamped).toBe(def); // same object, stamp rides as a data property
    expect(contractOf(stamped)).toBe(checkoutContract);
    // contractOf never mistakes an unrelated property bag for a stamp.
    expect(contractOf({ appContract: { app: 'x' } })).toBeUndefined();
  });
});

describe('props validation', () => {
  it('mounts when props satisfy the contract (optional members omittable)', async () => {
    const client = connectIslandWorker({ worker: contractWorker });
    const ops = await client.mount('checkout@1', { count: 2 });
    expect(ops.some((o) => o.t === 'create')).toBe(true);
    client.terminate();
  });

  it('rejects mount when a required prop has the wrong type', async () => {
    const client = connectIslandWorker({ worker: contractWorker });
    await expect(client.mount('checkout@1', { count: 'nope' })).rejects.toThrow(
      /checkout.*contract|expected number/i,
    );
    client.terminate();
  });

  it('rejects mount when a required prop is missing entirely', async () => {
    const client = connectIslandWorker({ worker: contractWorker });
    await expect(client.mount('checkout@1', {})).rejects.toThrow(/checkout/);
    client.terminate();
  });

  it('rejects updateProps with violating props on the mounted contract', async () => {
    const client = connectIslandWorker({ worker: contractWorker });
    await client.mount('checkout@1', { count: 1 });
    // updateProps replaces the whole prop set — the contract sees the full
    // shape, so omitting `count` fails even though the change is `label`.
    await expect(client.updateProps('checkout@1', { label: 'a' })).rejects.toThrow(
      /checkout.*contract|expected number/i,
    );
    await expect(
      client.updateProps('checkout@1', { count: 1, label: 42 }),
    ).rejects.toThrow(/expected string/i);
    // A good update still flows.
    await client.updateProps('checkout@1', { count: 2, label: 'alpha' });
    client.terminate();
  });

  it('unstamped apps skip validation entirely', async () => {
    const client = connectIslandWorker({ worker: contractWorker });
    const ops = await client.mount('loose@1', { anything: [1, 2, { three: 3 }] });
    expect(ops.some((o) => o.t === 'create')).toBe(true);
    client.terminate();
  });
});

describe('event validation', () => {
  it('declared events emit valid payloads; undeclared names pass through', async () => {
    const client = connectIslandWorker({ worker: contractWorker });
    const ops = await client.mount('checkout@1', { count: 3 });
    const dispatched = await client.dispatch(listenHandler(ops), { type: 'click' });
    const emits = dispatched.filter((o) => o.t === 'emit');
    expect(emits).toContainEqual({ t: 'emit', name: 'paid', payload: { total: 30 } });
    expect(emits).toContainEqual({
      t: 'emit',
      name: 'mystery',
      payload: { anything: true },
    });
    client.terminate();
  });

  it('a contract-violating payload on a declared event rejects the dispatch', async () => {
    const client = connectIslandWorker({ worker: contractWorker });
    const ops = await client.mount('bademit@1', {});
    await expect(client.dispatch(listenHandler(ops), { type: 'click' })).rejects.toThrow(
      /paid.*contract|expected number/i,
    );
    client.terminate();
  });
});
