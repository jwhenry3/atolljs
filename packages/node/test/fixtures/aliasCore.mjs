// Module-resolution hook for REAL node:worker_threads spawned by tests.
// Loaded via `new Worker(file, { execArgv: ['--import', <this file>] })`.
//
// '@atolljs/core' has no node_modules entry inside the packages/* scope —
// vitest resolves the specifier through its vite alias and consumers resolve
// it through their installed dependency. Map it onto the repo's built core
// bundle so plain workers can import the real sharedBuffer.ts, which itself
// imports '@atolljs/core'.
import { registerHooks } from 'node:module';

const CORE = new URL('../../../../dist/index.js', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@atolljs/core') {
      return { url: CORE, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
