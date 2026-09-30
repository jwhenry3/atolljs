/**
 * Island contract for the `lazyIsland` facade — resolves `{ app, worker }`
 * so the island carries its own worker factory and the call site needs no
 * `worker` prop at all. The dynamic `import('./incidents.island')` in
 * shell.tsx is the bundler's split point: this module (and anything it
 * pulls) only loads when the island mounts.
 *
 * `app` is the registry key as a STRING — importing the component itself
 * would drag worker-side code into the shell bundle; the name is the
 * whole contract.
 */
export const app = 'incidents';
export const worker = (): Worker =>
  new Worker(new URL('./worker/react.worker.tsx', import.meta.url), { type: 'module' });
