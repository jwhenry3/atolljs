/**
 * Contract fixture — a worker app stamped with a `defineIslandContract`
 * wire schema via `withContract`. Exercises: props validation at
 * mount/updateProps, declared-event payload checks at emit, and the
 * pass-through for undeclared event names.
 */
import { z } from '@atolljs/core';
import {
  defineIslandContract,
  definePolyWorker,
  emit,
  withContract,
  type ProxyDocument,
} from '@atolljs/islands/worker';

export const checkoutContract = defineIslandContract({
  app: 'checkout',
  props: z.object({
    count: z.number(),
    // zod/mini spelling — the vendored z is raw; fluent .optional() chains
    // live on reef/listSchema outputs, not bare z schemas.
    label: z.optional(z.string()),
    onSelect: z.optional(z.callback<(v: string) => void>()),
  }),
  events: {
    paid: z.object({ total: z.number() }),
  },
});

/** `withContract(contract, app)` — the imperative-def case. */
const checkoutApp = withContract(checkoutContract, {
  imperative: (doc: ProxyDocument, props: Record<string, unknown>): void => {
    const el = doc.createElement('div');
    el.className = 'checkout';
    el.textContent = `${String(props.label ?? 'checkout')}:${String(props.count)}`;
    const btn = doc.createElement('button');
    btn.className = 'pay';
    btn.textContent = 'pay';
    btn.addEventListener('click', () => {
      // Declared event, valid payload — lands on onEvent.
      emit('paid', { total: Number(props.count) * 10 });
      // Undeclared event — passes through (contract describes the wire,
      // it doesn't fence forward-compatible additions).
      emit('mystery', { anything: true });
    });
    doc.body.append(el, btn);
  },
});

/** A second app whose click emits a contract-VIOLATING payload. */
const badEmitApp = withContract(
  defineIslandContract({
    app: 'bademit',
    events: { paid: z.object({ total: z.number() }) },
  }),
  {
    imperative: (doc: ProxyDocument): void => {
      const btn = doc.createElement('button');
      btn.className = 'bad';
      btn.textContent = 'bad';
      btn.addEventListener('click', () => {
        emit('paid', { total: 'not-a-number' });
      });
      doc.body.append(btn);
    },
  },
);

/** An unstamped app — no contract, anything passes (control case). */
const looseApp = {
  imperative: (doc: ProxyDocument): void => {
    const el = doc.createElement('div');
    el.className = 'loose';
    el.textContent = 'loose';
    doc.body.append(el);
  },
};

export const contractWorker = definePolyWorker({
  apps: { checkout: checkoutApp, bademit: badEmitApp, loose: looseApp },
});
