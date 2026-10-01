/**
 * 'dial' worker entry — the Svelte micro-frontend, one app per worker.
 * vite-plugin-svelte compiles the .svelte component for the worker bundle
 * via `worker.plugins`.
 */
import { defineSvelteMonoWorker } from '@atolljs/svelte-island/worker';
import Dial from './svelte/Dial.svelte';
import dialContract from '../contracts/dial.contract';

export const dialWorker = defineSvelteMonoWorker(Dial, { contract: dialContract });
