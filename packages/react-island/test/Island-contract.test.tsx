// @vitest-environment happy-dom
/**
 * Contract-driven facades — `islandComponent(contract)` /
 * `lazyIsland(Promise.resolve(contract))` mount by the contract's `app`
 * key, take props off its schema, and narrow `onEvent` to the declared
 * event vocabulary. The fixture app is an imperative island — this file
 * never imports a worker framework, which is the whole point.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';
import { checkoutContract } from '../../islands/test/fixtures/contract.worker';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [
  () => import('../../islands/test/fixtures/contract.worker'),
];

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let islandComponent: typeof import('../src/index').islandComponent;
let lazyIsland: typeof import('../src/index').lazyIsland;
let realDoc: Document;
beforeAll(async () => {
  realDoc = document;
  ({ islandComponent, lazyIsland } = await import('../src/index'));
});

const contractWorker = () =>
  new Worker(
    new URL('../../islands/test/fixtures/contract.worker.ts', import.meta.url),
    { type: 'module' },
  );

const host = (): HTMLElement => {
  const el = realDoc.createElement('div');
  realDoc.body.appendChild(el);
  return el;
};

describe('islandComponent(contract)', () => {
  it('mounts by contract.app with schema-typed props and narrowed onEvent', async () => {
    // The facade IS the contract: registry key, props, and events all ride
    // the one generic — no component import anywhere.
    const Checkout = islandComponent(checkoutContract);
    const el = host();
    const emitted: Array<{ name: string; payload: unknown }> = [];

    const root = createRoot(el);
    await act(async () => {
      root.render(
        <Checkout
          worker={contractWorker}
          count={2}
          label="hi"
          onEvent={(name, payload) => {
            // name: 'paid' — the declared vocabulary; payload narrows per name.
            if (name === 'paid') void (payload as { total: number }).total;
            emitted.push({ name, payload });
          }}
        />,
      );
    });

    await vi.waitFor(() =>
      expect(el.querySelector('.checkout')?.textContent).toBe('hi:2'),
    );

    act(() => {
      el.querySelector('.pay')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await vi.waitFor(() => expect(emitted.some((e) => e.name === 'paid')).toBe(true));
    expect(emitted).toContainEqual({ name: 'paid', payload: { total: 20 } });
    // Undeclared names still pass through — forward-compatible events.
    expect(emitted).toContainEqual({ name: 'mystery', payload: { anything: true } });

    await act(async () => {
      root.unmount();
    });
  });

  it('rejects unknown props and wrong payloads at compile time', () => {
    const Checkout = islandComponent(checkoutContract);
    // @ts-expect-error — `count` is required by the contract's prop schema
    const _missing = <Checkout worker={contractWorker} />;
    // @ts-expect-error — `bogus` is not a contract prop
    const _badProp = <Checkout worker={contractWorker} count={1} bogus={1} />;
    // @ts-expect-error — `count` is a number, not a string
    const _badType = <Checkout worker={contractWorker} count="one" />;
    void _missing;
    void _badProp;
    void _badType;
    expect(typeof Checkout).toBe('function');
  });
});

describe('lazyIsland over a contract module', () => {
  it('resolves a contract object as the module — props infer P', async () => {
    const Checkout = lazyIsland(() => Promise.resolve(checkoutContract));
    const el = host();
    const root = createRoot(el);
    await act(async () => {
      root.render(
        <Checkout
          worker={contractWorker} // the fixture contract carries no worker
          count={5}
        />,
      );
    });
    await vi.waitFor(() =>
      expect(el.querySelector('.checkout')?.textContent).toBe('checkout:5'),
    );
    await act(async () => {
      root.unmount();
    });
  });
});
