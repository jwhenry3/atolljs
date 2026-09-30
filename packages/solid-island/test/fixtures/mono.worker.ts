/**
 * Island worker entry for the defineSolidMonoWorker path — one worker
 * pinned to a single plain-function Solid component (the isolated-bundle
 * host shape), with an explicit doorbell contract through `options` to
 * cover the `options?.sharedMemory` forwarding branch. Registers as
 * 'main' — mounts resolve it by sole-app fallback or explicit name.
 */
import { renderMemory } from '@atolljs/islands/worker';
import { defineSolidMonoWorker, h, insert } from '../../src/worker';

function Mono(props: Record<string, unknown>): ReturnType<typeof h> {
  const el = h('span', { class: 'mono' });
  insert(el, () => `mono:${String(props.tag ?? 'd')}`);
  return el;
}

export const monoWorker = defineSolidMonoWorker(Mono, { sharedMemory: renderMemory });
