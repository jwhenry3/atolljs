/**
 * Svelte poly-worker fixture — `defineSveltePolyWorker` wraps each registry
 * component through `svelteIslandApp`, and a `svelteIsland`-stamped app
 * registers beside them through the plain islands registry (the stamped
 * value IS a RenderedIslandApp already). IMPORTANT: the known second-mount
 * bug (see svelte-double.test.ts) means a test file may mount at most ONE
 * Svelte component — 'listeners' mounts in svelte-listeners.test.ts,
 * 'propsbox' in svelte-props.test.ts, and 'stamped' is registered for
 * name-resolution coverage but never mounted.
 */
import { definePolyWorker, renderMemory } from '@atolljs/islands/worker';
import { defineSveltePolyWorker, svelteIsland } from '../../src/worker';
import Listeners from './Listeners.svelte';
import PropsBox from './PropsBox.svelte';

/** Stamped component-reference handle — shell mounts it by reference. */
export const stampedApp = svelteIsland('stamped', PropsBox);

export const extrasWorker = defineSveltePolyWorker(
  {
    apps: { listeners: Listeners, propsbox: PropsBox },
    sharedMemory: renderMemory, // registry-level doorbell override branch
  },
  { sharedMemory: renderMemory }, // options-level fallback branch
);

export const stampedRegistry = definePolyWorker({
  apps: { stamped: stampedApp },
});
