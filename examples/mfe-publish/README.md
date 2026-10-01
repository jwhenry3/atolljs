# @atolljs/mfe-counter — the publishable side of the MFE pair

A standalone package whose public surface is a single framework-free
contract module. Pairs with [`../mfe-consumer`](../mfe-consumer/), which
consumes this package by name.

## The two artifacts

| Artifact | Kind | Where |
|---|---|---|
| `src/mfe/counter.contract.ts` | **module** — consumers `import` it | package `exports["."]` |
| `dist-mfe/counter.worker.js` | **fetched asset** — the browser downloads it as a `Worker` script | `files` (built by `vite.mfe.config.ts`) |

The contract's `worker` factory resolves the prebuilt bundle
package-relative (`new URL('../../dist-mfe/counter.worker.js',
import.meta.url)`), so the consumer's bundler emits it as an asset — or set
`VITE_MFE_ORIGIN` to point the factory at a remote origin instead (see
[`../../docs/islands-remote.md`](../../docs/islands-remote.md)).

## Commands

```bash
npm install
npm run build:mfe      # → dist-mfe/counter.worker.js (self-contained)
npm run dev            # harness on :5185 — mounts through the contract
npm run build          # build:mfe + harness build
npm run preview:mfe    # serve dist-mfe/ on :5186 with CORS (fake CDN)
```

The harness's worker factory is the same code consumers run — it needs
`dist-mfe/` built first (`npm run build` and `npm run dev` after a fresh
clone: run `build:mfe` once before `dev`).
