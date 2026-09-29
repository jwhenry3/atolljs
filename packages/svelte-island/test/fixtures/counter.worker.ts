/**
 * Instance-worker fixture for the svelteIslandApp tests — ONE Svelte-rendered
 * app stamped 'counter' via islandApp (a `defineMonoWorker` resolves its
 * single app regardless of the requested name, so the shell can mount it
 * namelessly or as 'counter').
 */
import { defineMonoWorker, islandApp } from '@atolljs/islands/worker';
import { svelteIslandApp } from '../../src/worker';
import Counter from './Counter.svelte';

export const counterApp = islandApp('counter', svelteIslandApp(Counter));

export const counterWorker = defineMonoWorker(counterApp);
