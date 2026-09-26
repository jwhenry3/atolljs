# mesh — package docs

Consumer-facing documentation for the `@jwhenry123/mesh` npm package (everything is a subpath: `/sdk`, `/<framework>`): install,
quickstart, API reference, per-framework usage, and hosting/headers guidance.
(The `docs/` site is the developer docs — internals, source walkthroughs, and
the in-page playground; this one is written for someone importing the packages.)

```sh
npm install
npm run dev    # http://localhost:4181
```

Or from the repository root — `npm run dev:all` launches it alongside
everything else, and `npm run serve:all` mounts the built site at
`/docs-consumer/` in the unified `dist/` tree.

Framework pages embed the live example apps: in dev they iframe the per-port
dev servers; in built output they hit `/<framework>/` on the same origin, which
resolves when served via `serve:all` (the framework apps are mounted beside it
in the unified `dist/` tree).

`SharedArrayBuffer` needs cross-origin isolation — COOP/COEP/CORP headers are
set in `vite.config.ts`, and iframes get `allow="cross-origin-isolated"`.
