/**
 * Instance worker — the 1:1 topology: this script serves exactly one app (the
 * imperative proxy-DOM island). Its bundle is just the proxy-DOM runtime +
 * the vendored widget — `@atolljs/islands/worker` is framework-neutral now,
 * so this script carries no React and no reconciler at all.
 */
import { defineMonoWorker } from '@atolljs/islands/worker';
import { vanillaApp } from './vanilla';

export const vanillaWorker = defineMonoWorker(vanillaApp);
