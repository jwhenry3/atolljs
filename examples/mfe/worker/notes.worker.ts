/**
 * 'notes' worker entry — the Vue micro-frontend, one app per worker
 * (defineMonoWorker). vite compiles the .vue SFC for the worker bundle via
 * `worker.plugins`; the contract module supplies the wire schemas.
 */
import { defineVueMonoWorker } from '@atolljs/vue-island/worker';
import Notes from './vue/Notes.vue';
import notesContract from '../contracts/notes.contract';

export const notesWorker = defineVueMonoWorker(Notes, { contract: notesContract });
