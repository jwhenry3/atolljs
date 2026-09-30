/**
 * Vue island worker — a registry worker serving Vue SFC apps through
 * `vueIslandApp` (Vue's createRenderer bound to the instance's proxy DOM).
 * Its bundle carries Vue but no React — the point of the demo: islands are
 * framework-agnostic over one op protocol.
 *
 * Components are real `.vue` single-file components — vite compiles them
 * for the worker bundle exactly like a client bundle (plugin-vue runs in
 * the worker build via `worker.plugins` in vite.config.ts).
 */
import { defineVuePolyWorker } from '@atolljs/vue-island/worker';
import Counter from './vue/Counter.vue';
import Incidents from './vue/Incidents.vue';
import Notes from './vue/Notes.vue';

export const vueWorker = defineVuePolyWorker({
  apps: { 'vue-notes': Notes, counter: Counter, incidents: Incidents },
});
