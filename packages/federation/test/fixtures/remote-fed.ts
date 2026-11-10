/**
 * A "remote module" fixture — what a published MFE chunk looks like to the
 * host: exposes map + module-level requires, an app stamped by
 * defineRemoteApp and bound to an island contract, reading the realm's
 * shared dep via useShared.
 */
import { z } from '@atolljs/core';
import {
  defineIslandContract,
  emit,
  withContract,
  type ProxyDocument,
} from '@atolljs/islands/worker';
import { defineRemoteApp, useShared } from '@atolljs/federation';

export const fedContract = defineIslandContract({
  app: 'fed',
  props: z.object({ label: z.optional(z.string()) }),
  events: { pong: z.object({ text: z.string() }) },
});

export const requires = { greeting: '^1' };

export const exposes = {
  fed: defineRemoteApp(
    withContract(fedContract, {
      imperative: (doc: ProxyDocument, props: Record<string, unknown>): void => {
        const greeting = useShared<{ text: string }>('greeting');
        const el = doc.createElement('div');
        el.className = 'fed';
        el.textContent = `${greeting.text}:${String(props.label ?? 'fed')}`;
        const btn = doc.createElement('button');
        btn.className = 'ping';
        btn.addEventListener('click', () => {
          emit('pong', { text: greeting.text });
        });
        doc.body.append(el, btn);
      },
    }),
  ),
};
