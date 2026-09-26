# mesh sdk docs

Documentation site for `@jwhenry123/mesh/sdk` and the framework bindings — Vite +
React, hash-routed, on port **4180**.

- Concept pages cover contracts, the worker pool/task model, and the reactivity
  layer (`observe`, `watch`, `defineTask`, logging).
- Each framework page embeds the real binding + glue sources (via `?raw`
  imports, so docs never drift from the code) and iframes the running example.
- The playground page runs a real worker + shared-memory contract in-page
  through the `@jwhenry123/mesh/react` bindings.

## Run

```sh
npm install
npm run dev    # http://localhost:4180
```

Or start it together with everything else from the repository root:

```sh
npm run dev:all
```

To serve the built docs with the prebuilt framework demos embedded:

```sh
npm run serve:docs   # builds docs + examples, serves http://localhost:4180
                     # with live demos mounted at /react/, /vue/, ...
```

SharedArrayBuffer needs cross-origin isolation — the vite config sets COOP/COEP
headers, so the live playground demo works in-page.
To assemble the GitHub Pages artifact locally:

```sh
npm run build:pages   # builds docs + consumer docs + examples -> dist-pages/
```

The `Deploy docs to GitHub Pages` workflow (`.github/workflows/pages.yml`)
publishes that tree on pushes to `main` — enable Pages in repo settings with
source "GitHub Actions". Note: Pages cannot send COOP/COEP headers, so the
embedded live demos and playground won't run there (SharedArrayBuffer is
unavailable); the docs content itself works fine.
