/**
 * Svelte mono-worker fixture — `defineSvelteMonoWorker` wraps the component
 * through `svelteIslandApp` and registers it as the single 'main' app; the
 * shell mounts namelessly. The options.sharedMemory branch is covered by
 * passing the doorbell spec explicitly.
 */
import { renderMemory } from '@atolljs/islands/worker';
import { defineSvelteMonoWorker } from '../../src/worker';
import Mono from './Mono.svelte';

export const monoWorker = defineSvelteMonoWorker(Mono, { sharedMemory: renderMemory });
