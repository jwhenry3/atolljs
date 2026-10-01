# mfe-consumer — the shell side of the MFE pair

A React shell whose only MFE dependency is the contract module from
[`@atolljs/mfe-counter`](../mfe-publish/) (`file:../mfe-publish` —
`exports["."]` → the contract; the worker source is never imported).

## How the prebuilt worker reaches the browser

The contract's `worker` factory is a package-relative
`new URL('../../dist-mfe/counter.worker.js', import.meta.url)` — through
the `file:` symlink it resolves to the producer's real `dist-mfe/`, and
vite serves/emits that file as an asset like any other. No CDN needed for
the npm-package distribution shape; the remote/CDN shape is the same
contract with `VITE_MFE_ORIGIN` set (see
[`../../docs/islands-remote.md`](../../docs/islands-remote.md)).

## Commands

```bash
# producer first — the contract references dist-mfe/, which must exist
cd ../mfe-publish && npm install && npm run build:mfe

cd ../mfe-consumer && npm install
npm run dev                 # :5187 — island mounts from the prebuilt bundle
npm run build && npm run preview

# remote-URL variant: serve the producer's dist-mfe/ on :5186, then
(cd ../mfe-publish && npm run preview:mfe)
VITE_MFE_ORIGIN=http://localhost:5186 npm run dev
```
