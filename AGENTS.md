# AGENTS.md — atoll

Worker-atoll framework monorepo: typed shared-memory worker pools, cross-thread
reactivity, framework bindings, and worker-rendered UI islands.

## Read the docs first

**Before doing any extensive work in this repo, read [`docs/README.md`](docs/README.md)
and every doc its reading map marks relevant to the area you're touching.**
The invariants that are easy to violate — fixed-width memory layout, bundler
worker-entry detection, island instance scoping, per-framework renderer
quirks — are documented there, not in code comments alone.

- `docs/` — the project documentation (markdown, this repo)
- `docs-consumer/` — the consumer-facing docs *site* (a Vite app; editing it
  is content work on that app, not on these docs)

## Commands

```bash
npm test            # vitest — all suites (sdk + packages + example e2e)
npm run build       # typecheck (tsc --noEmit) + lib build + app build
npm run dev:all     # every example dev server + the consumer docs site
npm run serve:all   # build everything, serve one origin on :4173
npm run serve:pages # build + serve the GitHub Pages artifact (dist-pages/) on :4174
npm run stats       # measure per-package bundle size → docs-consumer/src/bundleStats.ts
npm run stats:islands # bench per-framework worker/main split → docs-consumer/src/islandPerfStats.ts
```

Per-package checks: each `packages/*` dir is independently buildable; example
apps live in `examples/*`. Node tests run under `happy-dom`; browser-only
behavior is exercised via `InProcessWorker`
(`src/testing/inProcessWorker.ts`).

## Non-negotiable rules

- **Contracts are shared by both threads.** A `defineSharedMemory` spec must
  produce identical layout on main thread and worker — never fork the spec or
  hand-compute byte offsets. See `docs/shared-memory.md`.
- **Worker entries must stay bundler-detectable**: `new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })` inline — never hoist or compute the URL.
- **`import type` the worker definition** on the main thread; the client is a
  Proxy typed by `typeof worker` — worker code must not leak into main-thread
  bundles.
- **Islands: one instance per `app@N` key.** Worker-initiated DOM work outside
  a task must re-enter via `runInInstance(instance, fn)` + `bumpOpsVersion()`;
  ambient `document`/`window` resolution is a heuristic, not a contract.
  See `docs/islands-worker.md`.
- **Serialization boundary is `postMessage`/`structuredClone`** — props, task
  args, and results must be cloneable; big state lives in shared memory, not
  in messages.
- When you change a documented API or invariant, update `docs/` in the same
  change.
- **Every installable project carries the same `.npmrc`**
  (`min-release-age=7`, `ignore-scripts=true`, `save-exact=true`) — copy it
  into any new project directory. See `SECURITY.md` for the full
  supply-chain policy and the `npm rebuild --ignore-scripts=false` escape
  hatch.

## Repo shape

```
src/              core SDK (contract/ pool/ shared/ worker/ testing/)
packages/incidents/   demo domain package
packages/<fw>/        framework bindings (react, vue, solidjs, svelte, angular, nextjs)
packages/islands/     island engine — driver, op protocol, proxy DOM
packages/<fw>-island/ per-framework island shell + worker renderer
packages/cli/         the `atoll` bin — init/add/new/doctor scaffolder
                      (ships TS source; Node ≥22.18 type stripping — keep
                      `.ts` import extensions and erasable syntax)
packages/node/        node:worker_threads adapter (+ ./http socket routing)
packages/nestjs/      NestJS module + decorators
examples/<fw>/        demo apps; examples/react-dom-worker/ is the islands demo;
                      examples/http-offload/ serves HTTP inside pool workers (Node ≥26)
examples/express|fastify|hono|koa   plain-Node REST APIs on @atolljs/node
                      (esbuild-bundled worker entries — tsx paths don't reach
                      worker_threads)
docs/                 this project's documentation (markdown)
docs-consumer/        consumer docs site (Vite app — `npm run build` also runs
                      prerender.mjs, emitting one static HTML page per route)
scripts/              dev/serve/assemble orchestration
```
