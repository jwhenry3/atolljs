/**
 * Island worker entries for the defineVueMonoWorker / vueIsland paths:
 * - `monoWorker`: a 1:1 worker pinned to one component (isolated-bundle
 *   host shape) with an explicit doorbell through `options`.
 * - `stampedWorker`: `vueIsland(name, Comp)` — the stamp-and-wrap helper —
 *   handed straight to defineMonoWorker so its `islandAppName` stamp names
 *   the registry entry ('stamped').
 */
import { defineComponent, h } from 'vue';
import { defineMonoWorker, renderMemory } from '@atolljs/islands/worker';
import { defineVueMonoWorker, vueIsland } from '../../src/worker';

const Mono = defineComponent({
  name: 'VueMono',
  props: { tag: { type: String, default: 'd' } },
  setup: (props) => () => h('span', { class: 'mono' }, `mono:${props.tag}`),
});
export const monoWorker = defineVueMonoWorker(Mono, { sharedMemory: renderMemory });

const Stamped = defineComponent({
  name: 'VueStamped',
  setup: () => () => h('b', { class: 'stamped' }, 'stamped!'),
});
export const stampedApp = vueIsland('stamped', Stamped);
export const stampedWorker = defineMonoWorker(stampedApp, {
  sharedMemory: renderMemory,
});
