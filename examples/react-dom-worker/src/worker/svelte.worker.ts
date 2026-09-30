/**
 * Svelte island worker — a registry worker serving Svelte 5 components
 * through `svelteIslandApp` (`mount()` bound to the instance's proxy
 * document). Its bundle carries Svelte but no React — the point of the
 * demo: islands are framework-agnostic over one op protocol.
 *
 * Components are real `.svelte` files — vite-plugin-svelte compiles them
 * for the worker bundle just like a client bundle; runes and `{#if}` /
 * `{#each}` blocks work against the proxy DOM (comment anchors included).
 */
import { defineSveltePolyWorker } from '@atolljs/svelte-island/worker';
import Counter from './svelte/Counter.svelte';
import Incidents from './svelte/Incidents.svelte';
import Notes from './svelte/Notes.svelte';

export const svelteWorker = defineSveltePolyWorker({
  apps: { counter: Counter, notes: Notes, incidents: Incidents },
});
