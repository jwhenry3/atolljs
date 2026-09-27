# mesh

[![CI](https://github.com/jwhenry3/mesh/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/jwhenry3/mesh/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/jwhenry3/mesh/graph/badge.svg?branch=master)](https://codecov.io/gh/jwhenry3/mesh)

Typed shared-memory worker pools for TypeScript — deterministic `SharedArrayBuffer`
layouts, first-class task methods, and cross-thread reactive state.

## Packages

| Package | What it is |
|---|---|
| `@jwhenry123/mesh` | Core SDK — `defineWorker`/`connectWorker` typed worker clients over `WorkerPool`, shared-memory contracts, `watch`/`observe`, codecs |
| `@jwhenry123/mesh-react` | React hooks — `useObservable`, `useSharedValue`, `useTask` |
| `@jwhenry123/mesh-vue` | Vue composables — `useObservable`, `useSharedValue`, `useTask` |
| `@jwhenry123/mesh-solidjs` | Solid primitives — `createObservable`, `createSharedValue`, `createTask` |
| `@jwhenry123/mesh-svelte` | Svelte 5 rune bindings — `observableValue`, `sharedValue`, `taskState` |
| `@jwhenry123/mesh-angular` | Angular signals — `observableSignal`, `sharedValue`, `taskState` |
| `@jwhenry123/mesh-nextjs` | Next.js client-component bindings (React re-export) |
| `@jwhenry123/mesh-node` | `node:worker_threads` runtime adapter |
| `@jwhenry123/mesh-nestjs` | NestJS module/decorators for worker pools |

Framework bindings are published independently — install only the one you use:

```bash
npm install @jwhenry123/mesh @jwhenry123/mesh-react
```

## Documentation

Full docs deploy to GitHub Pages on every push to `master`:
[jwhenry3.github.io/mesh](https://jwhenry3.github.io/mesh/) —
`/sdk/` is the internals/SDK site (source: `docs/`), `/consumer/` the
package-usage site (source: `docs-consumer/`).

## Releasing

Create a GitHub Release tagged `v<semver>` — `.github/workflows/publish.yml`
runs the full test suite, builds the core `dist`, stamps every publishable
package at the tag's version (lockstep; `packages/incidents` stays private),
and publishes to npm with provenance. Requires a granular `NPM_TOKEN` repo
secret. Preview the plan locally: `node scripts/publish.mjs v0.1.0 --dry-run`.

## Layout

```
src/sdk/            core SDK — contract/ (shared protocol), pool/, worker/
packages/<fw>/      independently publishable framework bindings
packages/incidents/ demo domain package (contract + worker + pool)
examples/<fw>/      per-framework demo apps
docs/, docs-consumer/  documentation sites
```

## Scripts

```bash
npm test            # vitest — all suites (sdk + packages + example e2e)
npm run build       # typecheck + lib build
npm run dev:all     # launch every example dev server
npm run build:pages # docs + examples → dist-pages (GitHub Pages artifact)
```

Worker demos require cross-origin isolation (COOP/COEP) — the dev servers set it;
GitHub Pages cannot, so embedded live demos there are inert.
