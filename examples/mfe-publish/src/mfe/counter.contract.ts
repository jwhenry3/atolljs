/**
 * 'counter' — the React micro-frontend's PUBLIC contract and this package's
 * only export (`exports: { ".": "./src/mfe/counter.contract.ts" }`).
 *
 * Consumers import THIS module by package name and get the typed wire
 * surface — app key, props/event schemas, and a worker factory — without
 * ever seeing the worker source. `islandComponent(counterContract)` in a
 * shell is the whole integration.
 *
 * The worker factory resolves the PREBUILT bundle package-relative:
 * `../../dist-mfe/counter.worker.js` is the output of
 * `vite build --config vite.mfe.config.ts`, shipped inside the package via
 * the `files` list. From the consumer's bundler it's a `new URL(...,
 * import.meta.url)` asset — it is emitted/copied into the consumer's build,
 * or served from this directory in dev. `VITE_MFE_ORIGIN` swaps in a remote
 * origin (CDN / `vite preview --config vite.mfe.config.ts`) for the
 * fully-remote deployment shape.
 *
 * The file imports NO framework — it runs in the shell's bundle on the main
 * thread and inside the worker bundle on the worker thread.
 */
import { z } from '@atolljs/core';
import { defineIslandContract } from '@atolljs/islands';

const mfeOrigin = (import.meta.env as Record<string, string | undefined>)
  .VITE_MFE_ORIGIN;

// The package-relative prebuilt bundle, referenced as a plain ASSET (not
// `new Worker(new URL(...))` inline): the asset form makes the consumer's
// bundler emit the file verbatim, while the inline-worker form would
// re-bundle it as a worker entry. Source entries need bundler detection;
// an already-built artifact wants verbatim-copy semantics instead.
const bundledWorkerUrl = new URL(
  '../../dist-mfe/counter.worker.js',
  import.meta.url,
);

export const counterContract = defineIslandContract({
  app: 'counter',
  props: z.object({ label: z.string().optional() }),
  events: {
    incremented: z.object({ count: z.number(), label: z.string() }),
  },
  worker: () => {
    if (!mfeOrigin) {
      return new Worker(bundledWorkerUrl, { type: 'module' });
    }
    // Worker script URLs must be SAME-ORIGIN — new Worker('https://…')
    // throws SecurityError regardless of CORS headers; CORS governs the
    // fetches a worker makes, not its own script URL. The remote escape is
    // a same-origin module shim that imports the remote bundle: a blob:
    // URL inherits this page's origin, so the remote fetch only needs
    // Access-Control-Allow-Origin on the bundle (and its imports).
    const shim = `import ${JSON.stringify(`${mfeOrigin}/counter.worker.js`)};`;
    return new Worker(
      URL.createObjectURL(new Blob([shim], { type: 'text/javascript' })),
      { type: 'module' },
    );
  },
});

export default counterContract;
