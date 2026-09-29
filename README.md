# AtollJS

[![CI](https://github.com/jwhenry3/atolljs/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/jwhenry3/atolljs/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/jwhenry3/atolljs/graph/badge.svg?branch=master)](https://codecov.io/gh/jwhenry3/atolljs)

Typed shared-memory worker pools for TypeScript — deterministic `SharedArrayBuffer`
layouts, first-class task methods, and cross-thread reactive state.

## Packages

| Package | What it is |
|---|---|
| `@atolljs/core` | Core SDK — `defineWorker`/`connectWorker` typed worker clients over `WorkerPool`, shared-memory contracts, `watch`/`observe`, codecs |
| `@atolljs/react` | React hooks — `useObservable`, `useSharedValue`, `useTask` |
| `@atolljs/vue` | Vue composables — `useObservable`, `useSharedValue`, `useTask` |
| `@atolljs/solidjs` | Solid primitives — `createObservable`, `createSharedValue`, `createTask` |
| `@atolljs/svelte` | Svelte 5 rune bindings — `observableValue`, `sharedValue`, `taskState` |
| `@atolljs/angular` | Angular signals — `observableSignal`, `sharedValue`, `taskState` |
| `@atolljs/nextjs` | Next.js client-component bindings (React re-export) |
| `@atolljs/node` | `node:worker_threads` runtime adapter |
| `@atolljs/nestjs` | NestJS module/decorators for worker pools |
| `@atolljs/islands` | worker-side React reconciler + proxy DOM islands — opt-in DOM rendering |
| `@atolljs/react-island` | React shell components for islands — `<Island/>`, `islandComponent`, `lazyIsland` |
| `@atolljs/vue-island` | Vue shell (`useIsland`, `<AtollIsland>`) + Vue worker renderer |
| `@atolljs/svelte-island` | Svelte shell (`use:island`, `createIslandState`) + Svelte 5 worker renderer |
| `@atolljs/solid-island` | Solid shell (`createIsland`, `Island`) + `solid-js/universal` worker renderer |
| `@atolljs/angular-island` | Angular shell (`<atoll-island>`, `[atollIsland]`) + `Renderer2` worker renderer |

Framework bindings are published independently — install only the one you use:

```bash
npm install @atolljs/core @atolljs/react
```

## Documentation

- **`docs/`** — in-repo markdown documentation covering internals, contracts,
  islands, and per-framework bindings. Start at [`docs/README.md`](docs/README.md)
  (agents: `AGENTS.md` points here before extensive work).
- **`docs-consumer/`** — the consumer-facing package-usage site; deploys to
  GitHub Pages on every push to `master`:
  [jwhenry3.github.io/atolljs](https://jwhenry3.github.io/atolljs/) (`/consumer/`).

## Releasing

Create a GitHub Release tagged `v<semver>` — `.github/workflows/publish.yml`
runs the full test suite, builds the core `dist`, stamps every publishable
package at the tag's version (lockstep; `packages/incidents` stays private),
and **stages** each to npm with provenance. Staged versions aren't
installable until a maintainer approves them — `npm stage list` /
`npm stage approve <stage-id>` (2FA at approval, not in CI), or the Staged
Packages tab on npmjs.com. Requires a granular `NPM_TOKEN` repo secret.
Preview the plan locally: `node scripts/publish.mjs v0.1.0 --dry-run` —
it lists the exact tarball contents (`npm pack --dry-run`) and the stage
commands, with nothing written or published. The workflow run ends with a
step-summary table of every package staged and its result; each publishable
manifest also pins `publishConfig.registry` to `registry.npmjs.org`, so the
destination is declared in the repo rather than resolved from the
publisher's local npmrc.

Staging needs each package to already exist on the registry, so the first
release is a manual bootstrap — from the repo root:

```bash
npm login                                    # once
npm ci && npx vite build && npx tsc -p tsconfig.build.json
node scripts/publish.mjs 0.1.0 --direct      # prompts for 2FA per package
```

Once every package exists, release-driven `npm stage publish` works for
every subsequent version.

### Trusted publishing (OIDC)

Prefer OIDC over the `NPM_TOKEN` secret — no long-lived credential, and a
trust relationship can be **stage-only** so the workflow can't direct-publish
even if compromised. Configure per package (needs the package to exist on
npm, and npm CLI ≥ 11.10):

```bash
for p in core node react vue solidjs svelte angular nextjs nestjs \
         islands react-island vue-island svelte-island solid-island angular-island; do
  npm trust github "@atolljs/$p" --repo jwhenry3/atolljs --file publish.yml --allow-stage-publish -y
  sleep 2
done
```

Omit `--allow-publish` — stage-only. First call prompts for 2FA; choose
"skip for 5 minutes" and the loop finishes hands-free. Verify with
`npm trust list @atolljs/core`. Once every package shows the relationship,
delete the `NODE_AUTH_TOKEN` env line in `publish.yml` (npm only uses OIDC
when no token is present) — the secret can be revoked after.

## Layout

```
src/            core SDK — contract/ (shared protocol), pool/, worker/
packages/<fw>/      independently publishable framework bindings
packages/incidents/ demo domain package (contract + worker + pool)
examples/<fw>/      per-framework demo apps
docs/               in-repo markdown documentation (internals + bindings)
docs-consumer/      consumer docs site
```

## Scripts

```bash
npm test            # vitest — all suites (sdk + packages + example e2e)
npm run build       # typecheck + lib build
npm run dev:all     # launch every example dev server
npm run build:pages # consumer docs + examples → dist-pages (GitHub Pages artifact)
```

Worker demos require cross-origin isolation (COOP/COEP) — the dev servers set it;
GitHub Pages cannot send headers, so the Pages artifact ships `coi-sw.js`, a
service worker that injects them (first visit reloads once; islands fall back to
their poll transport where isolation still isn't available).
