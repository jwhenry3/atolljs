/**
 * Island contract for the `lazyIsland` facade — resolves `{ app, worker }`
 * so the island carries its own worker factory and the call site needs no
 * `worker` attribute at all. The dynamic `import('./incidents.island')` in
 * Shell.vue is the bundler's split point: this module (and anything it
 * pulls) only loads when the island mounts.
 */
export const app = 'incidents';
export const worker = (): Worker =>
  new Worker(new URL('../worker/vue.worker.ts', import.meta.url), { type: 'module' });
