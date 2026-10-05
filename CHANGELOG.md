# Changelog

## Unreleased

### `@atolljs/devtools`: overlay resize and clamping

- **The flyout resizes from every edge and corner**, not just the
  bottom-right grip, so a panel anchored at the bottom-right can grow up
  and to the left.
- **Dragging keeps the whole panel on screen**, close button included.
  Before, only a 60px strip had to stay visible, so the header's ✕ could end
  up offscreen. Clamping uses the visible viewport (page scrollbar excluded).
- **The panel refits** when the window resizes, when a page scrollbar
  appears, and when a drag starts. A size saved on a larger screen shrinks
  to fit instead of overflowing.

## 0.1.8

`connectWorker` / `connectSubWorker` take a `workers` count and build a
single `DedicatedWorker` when it's `1`. **Behavior change: `1` is now the
default**, so clients that relied on the implicit
`navigator.hardwareConcurrency` pool must pass `workers: 'auto'`. Devtools
grows from an observer into a toolkit: a control channel back into the live
app, inspectors for islands, shared memory and reactivity, audits,
recordings, OpenTelemetry export, a Chrome DevTools panel, and a dashboard
that ships with production vite builds.

### `@atolljs/core` — `connectWorker({ workers })`, devtools seams

- **New `workers` option** on `connectWorker` / `connectSubWorker`: a number
  or `'auto'`. `workers: 1` builds a new `DedicatedWorker` (one worker, no
  pool: no queue, no scheduler), keeping per-call timeout and abort, crash
  respawn, `stats()`, and devtools events (`pool:init` gains
  `dedicated: true`). More than one builds a `WorkerPool` as before.
- **Behavior change: the default is now `1`**, not `'auto'`. Clients that
  relied on the implicit `navigator.hardwareConcurrency` pool should pass
  `workers: 'auto'`. `poolSize` stays as a deprecated alias; `workers` wins
  when both are set. `new WorkerPool({ poolSize })`, `createNodePool`, and
  the framework pool modules are unchanged.
- `client.pool` is now typed `WorkerRunner<S>` (`WorkerPool<S> |
  DedicatedWorker<S>`); both share `stats()`, `workers`, `sharedBuffer`,
  `close()`, and `terminate()`. `resolveWorkerCount` is exported.
- **Runner ids derive from `name`**: a named pool is `<slug>-p`, a named
  dedicated worker `<slug>-w`, with a counter on repeats (`sla-p`,
  `sla-p2`). Unnamed runners keep `pool-N` / `worker-N`.
- **Devtools commands.** `registerDevtoolsCommand`, `listDevtoolsCommands`
  and `runDevtoolsCommand`; commands register lazily and only while
  devtools is enabled: `pool.list`, `pool.stats`, `worker.kill` (the real
  crash path, `'killed from devtools'`), `pool.chaos` (`delayMs`,
  `failRate`, `timeoutRate`), `memory.read`, `memory.watch` / `unwatch` /
  `watches`, `reactive.nodes`, and the built-in `devtools.commands`.
  Main-thread runners only.
- **`addDevtoolsSink(fn)`**: extra event listeners next to the transport
  sink; any listener enables worker forwarding.
- **New events**: `task:dispatch.argBytes`, `task:settle.resultBytes` (`ok`
  only) and `island:ops.bytes` (estimated clone size,
  `estimateCloneBytes`), `island:event.payload` and `island:props`
  (`previewValue`), `memory:watch-hit`, `runtime:longframe` and
  `runtime:frames`, `log` (SDK log entries mirrored at the current
  `setLogLevel`), and `reactive:node`.
- **User Timing**: `atoll task <taskId>`, `atoll run <taskId>` and
  `atoll replay <instance>` measures on an `atoll` track group in Chrome's
  Performance panel, cleared from the buffer right after recording.

### `@atolljs/islands` — dedicated island clients, renderer reporting, `island.*` commands

- Island clients (`connectIslandWorker`) run on `DedicatedWorker`.
- Island workers report their renderer: package adapters set
  `RenderedIslandApp.renderer`, a new `renderer(instance)` task returns it,
  and `island:mount` falls back to it when the mount declared no
  `framework` (queried only while devtools is enabled; an explicit tag
  wins). Imperative apps report `null`.
- Island `worker` shorthands (`mountIsland`, `<Island>`, `useIsland`,
  `createIsland`, the Svelte action, `atollIsland`) default `name` to the
  app name.
- Dashboard commands for main-thread islands: `island.list`, `island.tree`,
  `island.highlight`, `island.props`, `island.updateProps` (restores
  `'[fn]'` callback placeholders), `island.setMode`.

### `@atolljs/devtools` — live controls, inspectors, audits, recordings, OpenTelemetry

- **Control channel.** Dashboards send `control` frames back to a live app
  and get `control-result` replies (BroadcastChannel, or relayed by the
  aggregate server), driving the core and island commands above.
- **Session info**: `initDevtools({ session: { framework } })` reports the
  shell's own framework (`SessionInfo.framework`), drawn as the mark on the
  map's main-thread hub. `SessionInfo.env` reports `crossOriginIsolated`,
  `hardwareConcurrency` and friends. New `jank` option on `connectDevtools`
  (default on) feeds `runtime:longframe` / `runtime:frames`.
- **Dashboard views**: Performance (long frames, fps, message cost),
  island inspector tabs (Elements with in-page highlight, Props history
  with diffs, Events), Memory › Values (live values, snapshot diff,
  watchpoints), Reactivity (cross-thread dependency graph), Audits (20
  rules with thresholds, fixes and per-rule mute), and inspector controls
  (kill, chaos, edit props, push/poll).
- **App map**: a dedicated runner draws no P mark; the hub spoke runs
  straight to its worker, labeled with its id. Nested sub-worker fans
  tighten with many siblings so they stay pointed outward.
- The task-throughput chart sums sessions per second, windows the last 60s,
  and gains a y-axis scale, time ticks, and a latest/peak/avg/total line.
- **Recordings**: ● Rec / Export / Import with a replay banner (play,
  speed, scrub); format `atoll-devtools-recording` v1. Replayed sessions
  are closed and take no commands.
- **Shell**: Ctrl/⌘+K palette, `g`+letter view shortcuts, `[` `]`
  sub-tabs, `/` filter focus, `?` help, hash routes
  (`#/<view>[/<sub>][?session=&island=&worker=]`), view intros. Time series
  bucket on the dashboard clock, since worker-forwarded `at` is per-thread.
- **Overlay**: `persist` (position, size, open state) and `hotkey`
  (default `Alt+Shift+D`) options; "full page ↗" opens the flyout's
  current view.
- **`@atolljs/devtools/otel`.** `exportOtel({ endpoint, serviceName, ... })`
  sends traces (task calls, island round trips, fetches), cumulative metrics
  and logs to any OpenTelemetry backend over OTLP/HTTP JSON, with no new
  dependencies. Install it before pools spawn.
- **Server forwarding.** `createDevtoolsServer({ otlp })` and
  `atoll-devtools --otlp <url> [--otlp-headers k=v] [--otlp-service name]`
  (also on `atoll devtools`) export every connected session as its own
  resource.
- **Extension transport**: a third transport
  (`__ATOLL_TRANSPORT === 'extension'`) and a `body.ext` panel context (real
  history, Ctrl/Cmd+Shift+K palette) for the DevTools panel below.

### `@atolljs/vite` — `/__atoll/` in production builds

- A client `vite build` copies the dashboard into `<outDir>/__atoll/`
  whenever the bundle contains `@atolljs/devtools` code, so a shipped
  overlay flyout always has its page. Flagged for BroadcastChannel by an
  external `atoll-transport.js` (CSP-friendly, no inline script).
  `devtools: { build: 'auto' | true | false, dir? }` overrides; SSR builds
  are skipped. Hosts still serve the app's COOP/COEP on `/__atoll/`
  (`preview.headers` for `vite preview`). See `docs/devtools-deploy.md`
  topology A.

### `packages/devtools-extension` — Chrome DevTools panel *(private)*

- MV3. An **atoll** panel in Chrome DevTools runs the same dashboard against
  the inspected tab. Frames are pushed, not polled: a content script (all
  URLs, top frame, passive until a panel attaches) joins the page's
  `atoll-devtools` BroadcastChannel and relays through a module service
  worker that pairs it with the panel by tab id, including control
  commands, with reset and re-attach across reloads. No `permissions` keys,
  but the all-sites content script brings Chrome's "Read and change all
  your data on all websites" install warning; Chrome 114+. Build with
  `npm run build:extension` and load `dist/` unpacked.

### Examples & docs

- The vanilla islands demo (`index.html`) adds a framework row: Svelte,
  Solid and Angular `counter` islands next to the React, Vue, imperative and
  Leaflet ones, so one page runs every supported renderer.
- Every browser example sets `session.framework`.
- The Pages assembly keeps a demo's plugin-emitted `__atoll/` instead of
  overwriting it.

### CI & release tooling

- Tests run as four parallel shard jobs (`vitest --shard=i/4`) in both
  `ci.yml` and `publish.yml`; CI merges the shard blob reports and checks
  coverage thresholds once (`--shard` runs skip them).
- Coverage counts only the publishable surface: `examples/**` and non-JS
  files no longer match the `src/**` include.

## 0.1.7

New `@atolljs/devtools` package: live observability for pools, workers,
islands, shared-memory traffic, and task lifecycles — a same-origin dashboard
in the browser with no backend, and an opt-in aggregate server for Node apps
and cross-app views. No breaking changes.

### `@atolljs/devtools` — instrumentation dashboard *(experimental)*

- **The instrumentation seam is a sink, not a transport.** `src/devtools.ts`
  emits structured events (`pool:init`, `worker:spawn`/`crash`/`respawn`,
  `task:enqueue`/`dispatch`/`settle`, `memory:bind`/`write`, `net:fetch`,
  `runtime:memory`, island lifecycle) to an installed sink; transports are
  pluggable behind `connectDevtools()`. Workers forward their own events over
  `postMessage` only when the pool stamps `devtools: true` into INIT — a
  disabled app leaves workers with no sink, no fetch/memory probes, and zero
  devtools traffic, and `devtoolsEnabled()` guards event construction on
  hot paths so even the object allocation is skipped.
- **Browser mode needs no backend.** In a window, `connectDevtools()` defaults
  to `BroadcastChannel('atoll-devtools')`, so the dashboard is served on the
  app's own origin at `/__atoll/` (by `atoll()` from `@atolljs/vite`) and can
  only ever see that origin's sessions — the isolation is structural. Apps
  keep a 500-batch replay tail so a dashboard opened later gets session
  history.
- **URL-gated**: `initDevtools()` installs nothing unless `?__atoll_devtools`
  is in the URL (Node checks `ATOLL_DEVTOOLS` instead) — it must run before
  pools spawn. The same call mounts a floating overlay: a draggable, resizable
  flyout (`position` option: six anchors, default bottom-right) hosting a
  purpose-built mini layout whose `Map` tab is a full-size application map of
  pools, workers, and islands.
- **Node mode** uses the standalone aggregate server (`npx atoll-devtools`,
  dashboard + ingest at `http://127.0.0.1:4780`) over WebSocket. The client
  uses the global `WebSocket` on Node ≥ 22 and falls back to a bundled
  dependency-free RFC6455 client below it. Server sessions survive disconnect
  for post-mortem analysis — unpinned ended sessions sweep after 30 minutes;
  the session selector appears only here, where it's earned.
- **One package, three subpaths**: `@atolljs/devtools` (browser/client),
  `@atolljs/devtools/node` (Node apps — env gate, WebSocket only, no
  overlay), `@atolljs/devtools/server` (the aggregate). The Node client's
  `node:*` imports load behind a computed dynamic specifier, so browser
  tsconfigs and bundles never see them.
- `runtime:memory` covers `performance.memory` /
  `measureUserAgentSpecificMemory` in browsers and `process.memoryUsage()`
  in Node (reported as `rssBytes`), main thread and workers alike. Network
  instrumentation covers outbound `fetch()` only — inbound HTTP handled by a
  Nest/Express app isn't probed.
- Fix: the fallback Node WebSocket client left `open` reporting `true` after
  close and server close frames — `connectDevtools`' send gate kept writing
  into a dead socket.
- `atoll-devtools` accepts `--help`/`-h` and exits instead of booting the
  server (the publish pipeline's bin smoke relies on it).

### `@atolljs/cli` — `atoll add devtools`

- New `add` kind scaffolds observability into an existing app: writes
  `src/atoll/devtools.ts` — the init module you import first in your entry so
  the sink exists before pools spawn — and offers `@atolljs/devtools` as a
  dev dependency. The emitted file matches the detected host: browser apps
  get the `?__atoll_devtools` BroadcastChannel + flyout form, Angular apps
  get the aggregate-server variant (their dev server mounts no `/__atoll/`),
  and Node hosts get the `@atolljs/devtools/node` entry gated on
  `ATOLL_DEVTOOLS=1`. A positional/`--name` argument sets the dashboard
  session label (default: the package name).

### Release tooling

- `scripts/publish.mjs` takes an optional package positional —
  `publish.mjs <ver> devtools` (accepts the scoped name, unscoped part, or
  directory) — to build/stamp/stage one package; internal deps still stamp
  to the release version and warn when they aren't on npm yet. Combined
  with `--direct` this is the one-command bootstrap for a new package.
- Re-runs are safe: a package whose target version is already published (or
  staged, pending approval via `npm stage list`) is skipped instead of
  hard-failing on `EPUBLISHCONFLICT`.

### `@atolljs/vite` — `/@fs/` worker entries, `/__atoll/` mount

- Fix: `?worker_file` entry paths were resolved against the project root
  verbatim, so a worker entry outside the root — every workspace-linked
  package, which vite serves as `/@fs/<abs>` dev URLs — bundled as
  `<root>/@fs/...` and failed (`Could not resolve`). The middleware now
  unwraps dev-URL prefixes through the same `toFsPath` the bundle resolver
  uses; note win32 `isAbsolute('/x')` is true, so the absolute check requires
  a drive letter. `atoll.test.ts` gains an `/@fs/` entry case.
- The plugin also serves the devtools dashboard at `/__atoll/` (mini layout
  at `?mini=1`), resolving `app/` through the app's own dependency graph and
  echoing `server.headers` — required for both the overlay iframe (COOP) and
  worker scripts (COEP).

### Examples & docs

- Devtools wired into every demo: vite pool demos and island hosts call
  `initDevtools()` (`?__atoll_devtools`); the six Node APIs (express, fastify,
  hono, koa, nestjs, http-offload) import a `src/devtools.ts` module **first**
  so the sink is installed before their pools spawn — pools created earlier
  never stamp `devtools: true` into worker INIT. `mfe-*` and `nextjs` follow
  the same pattern; `angular` (no vite plugin) feeds the aggregate over
  WebSocket, demonstrating both topologies.
- `npm run dev:all` now launches the aggregate server on :4780 and arms
  `ATOLL_DEVTOOLS=1` for the Node demos.
- New `docs/devtools.md` (sink seam, transports, worker-forwarding
  invariants, `/__atoll/` mount, session lifecycle); consumer docs site gains
  a `/devtools/` page; `packages/devtools/README.md` documents the three
  subpaths.
- Coverage: new suites for the overlay, init gating, client transports, and
  the RFC6455 frame codec (masked/fragmented/large frames, ping/pong, close
  semantics over real sockets) plus core fetch/memory probe tests —
  `packages/devtools` at ~94% statements; every publishable package is now
  in the CI typecheck loop.

## 0.1.6

Fix `watch`/`observe` silently never firing under Node runtimes: `solid-js`
resolves to its SSR build via `node`/`worker`/`deno` export conditions, so
`createEffect` never re-ran and the whole reactive chain was dead (task
dispatch and direct reads still worked, hiding it). A runtime probe now
detects the inert build and `watch` falls back to driving select/emit
straight off the shared version counter — no signals involved. Reported via
micro-mmo's NestJS gateway, where `--conditions=browser` was no escape either
(it breaks `ws`/`engine.io` in the same process). Adds
`src/reactive.node.test.ts` covering emit-on-write, initial fire, unsubscribe,
and selector equality under the `node` environment.

### Island contracts — `@atolljs/islands`

Shells can now mount worker-rendered islands by **contract** instead of by
framework-coupled reference. `defineIslandContract({ app, props?, events?,
worker? })` publishes a framework-free module — registry key, `z` schemas for
props and the declared `emit` vocabulary, and an optional worker factory —
that both threads import and neither side's framework crosses.

- `islandAppNameOf` resolves contracts to their `app` key, so `app:
  contract` works anywhere an app reference does. `IslandAppProps`,
  `IslandEventHandler`, and `IslandContractEventHandler` project prop/event
  types off the contract's schemas, and every facade gets that inference:
  React/Vue/Solid `islandComponent(contract)`, `lazyIsland` over a contract
  module, Svelte's `use:island={{ app: contract }}`, Angular's
  `islandComponent({ contract, selector })`.
- `contract.worker` is consumed automatically at each facade's mount seam
  when no explicit `worker`/`client` is passed — call sites wire nothing.
- **Worker-side enforcement**: `withContract(contract, app)` (or the
  adapters' `{ contract }` option) stamps the registry entry; props parse at
  mount and `updateProps`, declared event payloads parse at `emit`, and
  undeclared events pass through — drift fails loudly instead of dropping
  fields.
- Angular's `angularIslandApp(Component, { contract })` types the contract
  as `IslandContract<IslandInputs<C>, IslandEvents<C>>`, so a contract
  missing an `input()`/`output()` field fails at the *MFE's* compile time.

### `z` vocabulary — message-domain kinds (`src/contract/zod.ts`)

The bundled schema engine gains `optional`, `nullable`, `literal`, `union`,
`record`, and `ZodObject.exact()`, plus fluent factories so
`z.string().optional()` works — contracts can express `{ label?: string
}`-shaped payloads that `reef`'s fixed-width layout intentionally can't.
The split is documented: `reef` = buffers, `z` = messages.

### Inter-framework MFE examples — `examples/mfe/` + `examples/*-host/`

- `examples/mfe/` models five published MFEs — one contract + one mono
  worker each (React counter, Vue notes, Solid ticker, Svelte dial, Angular
  checkout) — as shared source every shell consumes by contract only.
- `examples/react-host`, `vue-host`, `solid-host`, `svelte-host`,
  `angular-host` each mount all five; no shell bundle imports a foreign
  framework. Wired into `apps.mjs` (ports 5180–5184), `assemble.mjs`, and
  the Pages pipeline (`pages-lib.mjs` DEMOS + per-demo `coi-sw.js`,
  `build-pages.mjs`).
- `examples/mfe/tsconfig.json` carries Angular's legacy decorator flags —
  shared sources outside a host's tsconfig previously resolved the root
  config and emitted native TC39 decorators, crashing the Angular worker in
  every host (`WorkerCrashedError`).
- The Solid ticker's `setInterval` now calls `bumpOpsVersion()` — inside
  `runInInstance` the proxy-DOM auto-bump is suppressed and `emit` doesn't
  ring the doorbell, so the ticker silently stalled at `pulse: 0`.
- `solid-host` is authored in JSX via `vite-plugin-solid` (per-file
  `@jsxImportSource solid-js` pragma; the tsconfig stays `react-jsx` for the
  shared React worker sources).
- All hosts are header-less-host safe: `coi-sw.js` bootstrap in each
  `index.html` plus isolation detection falling back to poll/doorbell-free
  transport.

### `*-island` facades — `workerOptions.doorbell` typing

Solid/Svelte/Vue/Angular widen `workerOptions` to `IslandWorkerOptions & {
doorbell?: boolean }` — the runtime already spread it into
`connectIslandWorker` but the types rejected it, which blocked the
doorbell-free fallback on non-isolated pages. React already admitted it.

### `@atolljs/cli` — `add mfe` and `new --mfe`

- `atoll add mfe <name>` emits the publishable-MFE triple into an existing
  project: `src/mfe/<name>.contract.ts` (`defineIslandContract` — the
  framework-free module both sides share), `<name>.worker.*` with the
  contract attached (`define*MonoWorker(App, { contract })`), and a root
  `vite.mfe.config.ts` that builds `dist-mfe/<name>.worker.js` — one
  self-contained ESM bundle for CDN deploy, with the CORS preview headers
  baked in as the serving example.
- `atoll new <dir> --mfe` scaffolds a standalone MFE package — the same
  contract + worker + publish build, plus a dev harness page that mounts
  the island through the contract, so `vite dev` previews exactly what a
  consuming shell sees.

### Publish/consume e2e — `examples/mfe-publish` + `examples/mfe-consumer`

A working two-project publish pair: `mfe-publish` is a standalone package
(`@atolljs/mfe-counter`) whose `exports` entry is the contract module and
whose `vite.mfe.config.ts` emits a self-contained
`dist-mfe/counter.worker.js`; `mfe-consumer` depends on it by `file:` and
mounts the island through `islandComponent(counterContract)` — no worker
source or framework in its own graph. Verified end to end: the consumer's
build emits the producer's bundle **verbatim** as an asset, and
`VITE_MFE_ORIGIN` repoints the same contract at a remote origin. Building it
exposed three real gotchas, all now baked into the scaffolded
`vite.mfe.config.ts`:

- **Worker script URLs must be same-origin.** `new Worker('https://cdn…')`
  throws `SecurityError` regardless of CORS — CORS only governs the fetches
  a worker *makes*. Remote loading goes through a same-origin `blob:`
  module shim that `import`s the remote bundle; the remote host then needs
  only `Access-Control-Allow-Origin`.
- **Lib builds don't define `process.env.NODE_ENV`.** Framework dev/prod
  checks crash on a bare `process` in a browser worker — the publish config
  sets `define: { 'process.env.NODE_ENV': '"production"' }`.
- **The contract's own `worker` URL self-embeds.** The worker entry bundles
  the contract, so its `new URL('../../dist-mfe/…')` resolves the *previous*
  build output and inlines it into its successor — the bundle grew ~1MB per
  rebuild. A small `enforce: 'pre'` plugin stubs the dead URL.
- Related: referencing a prebuilt bundle via inline
  `new Worker(new URL(...))` makes the consumer's bundler *re-bundle* it as
  a worker entry; a hoisted `const url = new URL(...)` gives verbatim asset
  emission — the shape the example contract uses.

### Docs

- New `docs/islands-remote.md` — the two distribution shapes (npm package
  with `dist-mfe/` inside vs remote/CDN), the same-origin worker-URL rule
  and the blob-shim pattern, the publish-build gotchas above, the CORS/COEP
  serving matrix, versioned-URL rules, remote registry workers, and the
  drift failure table.
- `docs/islands.md`, `islands-worker.md`, `islands-frameworks.md`,
  `reef.md`, `docs/README.md` — contract semantics, worker-side
  enforcement, remote pointer, reading-map entries.
- Consumer docs site: new `island-mfe` page (contract boundary, per-shell
  call-site snippets, remote deployment section, live demos) with route +
  SEO metadata. The wide-viewport demo rail now clears the sticky site
  header (`top: 24px` → `68px` — the tab strip was being clipped), and the
  page renders all five hosts so `docs.js` folds them into the tabbed dock.
- Blog: new four-post **Micro-frontends** series — the worker-isolation
  pitch (`microfrontends`), the framework-neutral contract as the seam
  (`mfe-contract`), npm-vs-CDN publishing and the same-origin worker rule
  (`mfe-publishing`), and use cases plus honest limits (`mfe-use-cases`).
  `docs/islands-remote.md` now maps to the `island-mfe` consumer route in
  `DOC_ROUTES` so posts and docs link it as a site page.

## 0.1.5

Fixes `atoll new`-generated React projects, which crashed their island
worker on every spawn in `vite dev` (`worker error: Uncaught
ReferenceError: window is not defined` → respawn loop) and then, once the
worker survived, hung `mountIsland` at the 15s timeout because the worker
never answered `EXECUTE_TASK`. Two independent bugs, both only visible
when the SDK is consumed from `node_modules` (the examples alias to
source, which is why they never hit either).

### `@atolljs/core` — worker message pump survives bundling

- `workerBootstrap` now exports `installWorkerListener()` and
  `defineWorker()` **calls it** instead of relying on
  `import './workerBootstrap'` as a bare side effect. Vite's dep
  optimizer (dev) and bundlers (build) were tree-shaking the import:
  `sideEffects: ["**/workerBootstrap.ts"]` matches the source filename but
  not its flattened dist chunk (`index16.js`), so the whole
  `self.onmessage` pump — INIT_MEMORY binding and EXECUTE_TASK dispatch —
  vanished from optimized/bundled workers. An explicit call can't be
  shaken. The module still auto-installs on import, so direct
  `import '@atolljs/core/worker/workerBootstrap'` entries (NestJS/Next.js
  workers) are unaffected.

### `@atolljs/vite` — new package: dev workers as bundles, not module graphs

- New plugin `atoll()` intercepts `?worker_file`/`?sharedworker_file`
  requests before vite's transform middleware and answers them with an
  esbuild bundle — so browser-only transforms (react fast-refresh,
  `/@vite/client`, SFC HMR) can never leak into worker code, and no
  per-plugin `exclude` is needed. Worker-side HMR can't preserve a worker's
  module graph anyway; on any input-graph change the plugin rebuilds the
  bundle and sends `full-reload`, so the next worker spawn runs fresh code —
  rebuild + respawn is the worker reload flow.
- Resolution is bridged through vite's `pluginContainer` (aliases, tsconfig
  paths, and virtual modules apply inside worker bundles); styles/assets
  resolve to empty modules. Worker graphs containing framework SFCs
  (`.vue`/`.svelte`) fall back to vite's per-module pipeline — those plugins
  don't inject `window`-bound code at module scope, so the fallback is safe.
- Worker responses echo `server.headers` — required because Chrome blocks
  worker script fetches lacking the page's COEP under `require-corp`
  (`ERR_BLOCKED_BY_RESPONSE`, an opaque `worker error`). Documented in
  `docs/cross-origin-isolation.md` and `docs/vite-plugin.md`.
- Ships compiled `dist/` like the CLI (Node won't type-strip `.ts` under
  `node_modules`); `vite` is a peer dep, `esbuild` a dependency.

### Node-facing packages ship compiled `dist/` — `node`, `nestjs`, `nextjs`, `incidents`

- Bare Node can't type-strip `.ts` under `node_modules`
  (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`) — in-repo it never bites
  because workspace links are symlinks and the check uses realpaths. The
  four packages consumers load through plain Node (compiled apps,
  `worker_threads`, bundled worker entries' external imports) now build
  `dist/` via `scripts/build-lib.mjs`: one esbuild ESM bundle per exports
  leaf (code splitting keeps shared modules single-instance across
  subpaths) plus real `.d.ts` declarations — emitted by tsc, with `.js`
  appended to extensionless relative specifiers so the type graph resolves
  under consumer `nodenext`, not just `bundler`.
- Repo `exports` stay mapped to `./src/` so in-repo dev/tests keep
  resolving sources; `scripts/publish.mjs` rewrites staged manifests to
  `./dist/` (types → `*.d.ts`), gated on the dist target existing so a
  map↔build drift fails loudly.
- `@atolljs/core` likewise emits real `dist/**/*.d.ts` (it declared
  `types: ./dist/index.d.ts` without ever emitting it), and its `"./*"`
  export now resolves deep-subpath types from the emitted mirror while
  `default` still serves `./src/*` to bundlers.

### `@atolljs/cli` — scaffolds use `atoll()` from `@atolljs/vite`

- Every framework scaffold emits `import atoll from '@atolljs/vite'` +
  `atoll()` in `plugins` (solid emits `atoll({ jsxImportSource:
  'solid-js' })`), and `@atolljs/vite` joins `devDependencies`.
- The react scaffold keeps `react({ exclude: [/\/node_modules\//,
  /\.worker\./] })` as a safety net: plugin-react injects a fast-refresh
  tail (`import * as RefreshRuntime from "/@react-refresh"`, which reads
  `window` unguarded) into every transformed module — including
  `*.worker.tsx` entries served as `?worker_file`, which have no
  `window`. `exclude` **replaces** the plugin's default
  `/node_modules/` filter, so the array must carry both patterns — an
  exclude of just `*.worker.*` lets the refresh tail land inside
  `.vite/deps` chunks instead.

## 0.1.4

Fixes the published `atoll` bin — `npx @atolljs/cli` failed under 0.1.3
with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, because Node refuses
type stripping for `.ts` files under `node_modules` (where npx installs
the package). No breaking changes to the 0.1.3 API.

### `@atolljs/cli` — bundled bin

- **`bin` now points at `dist/cli.js`** — the TypeScript sources are
  bundled by esbuild at stage time (`scripts/publish.mjs` builds and
  smoke-tests the bundle before stamping), so the shipped bin is plain
  JavaScript that runs installed. The `src/` TypeScript sources still
  ship in the tarball for transparency.
- **Node floor drops to ≥ 20.12** — with no type-stripping requirement
  left, the only hard dependency is `node:util`'s `styleText`.
- Local development is unchanged — `npm run atoll`, vitest, and the CI
  smoke all still exercise `src/cli.ts` through Node's type stripping.

### Tooling

- `esbuild` joins the root dev dependencies for the CLI bundle.

## 0.1.3

The `atoll` CLI ships — a zero-dependency scaffolder/doctor covering every
example topology (workers, islands, NestJS, Next.js) — plus a blog front-matter
`pinned` flag and deeper NestJS docs. No breaking changes to the 0.1.2 API.

### `@atolljs/cli` — the `atoll` scaffold/doctor bin *(experimental)*

New package shipping a source-level TypeScript CLI (Node ≥ 22.18 type
stripping — no build step, zero runtime dependencies):

- **`atoll new <dir>`** — scaffold a fresh app: Vite shell + worker-rendered
  island for `react`/`vue`/`solid`/`svelte`, or a tsx Node service with a
  pooled worker (`--framework node`). Bootstrap install passes an explicit
  one-time `--min-release-age=0` so freshly published `@atolljs/*` releases
  aren't blocked by the generated project's own 7-day cooldown.
- **`atoll init`** — wire Atoll into an existing project: hardened `.npmrc`,
  dependency install, and a contract + worker + client spine under
  `src/atoll/`.
- **`atoll add [framework] <kind> [variant] [name]`** — generate pieces into
  an existing project, one kind per example topology:
  - **Frontend** — `worker` emits the pool + typed client (with a
    `defineTask` latest-wins wrapper) plus framework bindings on UI
    projects (`useX` hooks for react/nextjs/vue, `createX` for solid, a
    runes module for svelte, an `@Injectable` facade for angular);
    `island` emits `facade` (default — `<name>.app` + poly worker +
    `<name>.island.ts` contract module + `lazyIsland`/`islandComponent`/
    `use:island` usage) or `mono` worker variants; `memory` emits a
    `defineSharedMemory` contract. Workers co-located with a `*.memory.ts`
    contract pick it up automatically.
  - **NestJS** — `service` (`@AtollService` class + `registerPool` module +
    `runAtollWorker` entry), `method` (`@AtollTask` service + wiring hint),
    `module` (pool boundary + worker entry), `housed` (worker + api module +
    controller + atoll module + printed `proxyToWorker` gateway wiring).
  - **Next.js** — `route task|client` (`app/api/<name>/{contract,worker,
    pool,route}.ts` covering both example topologies), `component` (`'use
    client'` hooks component), `instrumentation` (boot warmup `register()`).
  - Variants resolve as a positional, `--variant`, an interactive `select`,
    or the first variant non-interactively; a leading framework word
    overrides auto-detection; kind scope is enforced per framework.
- **`atoll doctor [--fix]`** — checks deps, lockfile, `.npmrc` policy,
  bundler-detectable worker entries (`new Worker(new URL(...))` inline), and
  COOP/COEP headers; `--fix` writes the hardened `.npmrc`.
- **Colored output** — semantic styling (bold headings/prompts, dimmed
  secondary detail, cyan accents for commands and paths) via `node:util`
  `styleText`; respects `NO_COLOR`/`FORCE_COLOR`/TTY detection, so piped
  output stays clean. The `Io` seam keeps tests ANSI-free.
- Generated code preserves the bundler-detection and shared-contract
  invariants out of the box; the Node template demonstrates a real
  worker→main shared-memory write.

### `@atolljs/react-island` — ambient reconciler types reach consumers

`reactInstance.ts` now carries `/// <reference path="./react-reconciler.d.ts" />`
so the bundled ambient declaration for `react-reconciler` (which ships no
types) enters the consumer's program — previously `tsc --noEmit` in a project
importing `@atolljs/react-island` failed with TS7016.

### Examples & docs

- Blog — post front matter gains a `pinned` flag: pinned standalone posts
  sort ahead of series groups in both the sidebar and the blog index
  ("Introducing AtollJS" is pinned). Series headings in the blog sidebar now
  align with the top-level nav links.
- "Introducing AtollJS" gains a server section — `@AtollService` facades,
  `AtollModule.registerPool` on the API thread, `runAtollWorker` booting a
  Nest context per worker, and housed APIs.
- "Dependency Injection Across the Boundary" expands into the real
  `examples/nestjs` code — the full four-file `ReportService`/`DashboardService`
  facade example, and a dedicated housed-API section covering the worker-side
  `serveHttp` bootstrap, `proxyToWorker` gateway wiring, port tracking, and
  respawn reclaim.
- Root `npm run atoll` script runs the CLI from source (Node ≥ 22.18 type
  stripping — no build step needed).
- Versioned docs — each release now builds an immutable snapshot of the
  consumer site and attaches it as a `docs-v<x.y.z>.tar.gz` release asset;
  Pages deploys mount them under `consumer/v<major.minor>/` (newest patch
  per minor line wins). A header version switcher swaps between `latest`
  and snapshots while preserving the current route, and a runtime-fetched
  `consumer/versions.json` keeps even old snapshots aware of newer releases.
  Snapshots are `noindex`ed so search engines keep ranking `latest`.

## 0.1.2

Decorator-driven islands facades (Angular, Vue), framework-native demo shells
with a shared 1M-record benchmark, a split housed-API topology for NestJS,
deeper framework docs, and a broad test/coverage hardening pass. No breaking
changes to the 0.1.1 API.

### Angular islands facade — `@AngularIsland` + `islandComponent`

`@atolljs/angular-island` now centers on the worker component class as the
island contract:

- **`@AngularIsland`** — a class decorator that stamps the registry name
  (default `CounterComponent` → `'counter'`) and registers the component, so
  `defineAngularPolyWorker()` collects every decorated component with no
  `apps` map. An `apps` array form names undecorated entries the same way;
  the record form is unchanged.
- **Root outputs bridge to `emit`** — a root component's `output()`/
  `model()` fields forward onto the island emit channel under their public
  names (`x = model()` → `'xChange'`), with the adapter handling island
  instance re-entry — the component's declared API is the event contract.
- **`islandComponent<C>({ app, client|worker, selector? })`** — generates a
  standalone shell component (hand-authored `ɵcmp` — AOT and JIT safe) whose
  `[props]`/`onEvent` are typed via `IslandInputs<C>`/`IslandEvents<C>`/
  `IslandEventHandler<C>` off the class's `input()`/`model()`/`output()`
  fields; `import type` keeps the worker module out of the shell bundle.
- **Low-level surface gains** — `<atoll-island>`/`[atollIsland]` are now
  generic (`AtollIslandComponent<C>`), accept `worker`/`workerOptions`/
  `mode` inputs (a `connectIslandWorker` call is no longer mandatory), and
  `[app]` accepts the stamped component class directly.

### Vue islands facade — `islandComponent` + `lazyIsland`

`@atolljs/vue-island` gains the proxy-component pair the React binding
introduced — worker apps mount typed like local components:

- **`islandComponent<P>(app?)`** — every attribute that isn't a shell key
  (`worker`/`client`/`workerOptions`/`mode`/`on*`/`slots`/`containerProps`)
  forwards as the island's props, tracked through the reactive props getter
  so attribute updates push `updateProps` automatically. Vue fallthrough
  semantics are honored: `class`/`style`/`id`/`data-*`/`aria-*` land on the
  island's container div, not in props.
- **`lazyIsland(loader, asyncOptions?)`** — built on Vue's own
  `defineAsyncComponent` (loading/error states pass through as options, no
  thrown-promise Suspense needed); resolves `{ default: app }`, bare
  components, and contract modules `{ app, worker }` — including
  registry-key strings — so a lazy island can carry its own worker factory.
- `useIsland`/`AtollIsland` gained a `mode` input (`'push'`/`'poll'`),
  forwarded to `mountIsland`.

### NestJS — housed APIs on a dedicated pool

`examples/nestjs` restructures the housed-API demo so each worker entry is
single-purpose and lives beside the module that spawns it:

- Worker entries moved into their feature directories —
  `digest/digest.worker.ts`, `shared/incidents.worker.ts`,
  `housed/housed.worker.ts` — every `new Worker(new URL('./x.worker.ts'))`
  stays inside its own directory (webpack chunk detection unchanged).
- The `/api/housed` routes run on their **own pool** (`'housed'`,
  `poolSize: 2`): message-only, with `withSharedBuffer` feeding each spawned
  worker the incidents pool's `sharedBuffer` and `bindSharedBuffer` binding
  contracts before `NestFactory.create(HousedApiModule)` boots — two pools,
  one shared buffer, no second allocation.
- `main.ts` mounts `proxyToWorker({ pool, tracker, to, worker })` for the
  prefix with `workerHttpPorts` tracking announcements; the
  `HTTP_PORT_QUERY` handshake covers announcements that race the tracker,
  and respawned workers reclaim their prefixes on re-announce.

### Bug fixes

- `island.ts` — the `clear` op now tears down slot anchors
  (`unmountSlotSubtree` before `replaceChildren`); presence-form boolean
  attributes (`checked`, `disabled`) map to their live DOM property instead
  of being dropped; `destroy()` no longer terminates a shared client while a
  remount is mid-handshake.
- `island.ts` — driver-side `style` objects now get React-DOM unit
  semantics: numbers on non-unitless properties gain `px` (a bare
  `height: 24000000` was silently dropped by the browser, breaking
  virtualized scrollers), custom properties and kebab-case keys route
  through `setProperty` in both the prop-object and `style`-op paths.
- `react-island` — `lazyIsland` contract modules may carry a registry-key
  string (`{ app: 'incidents', worker }`), so a lazy island's worker factory
  travels with the contract; `workerOptions.doorbell` is now typed (the
  runtime already forwarded it).
- `vue-island` — `insertStaticContent` mirrors real Vue DOM: intact cached
  bounds are cloned along the sibling chain, detached bounds fall back to
  re-parsing (re-mounted static ranges no longer lose all but their head
  node); `useIsland` status/error semantics match the other bindings
  (`'idle'`/`'destroyed'` states, `updateProps` failures surface through
  `error`).
- `solid-island` — the props proxy's `has`/`ownKeys`/descriptor traps are
  reactive (`mergeProps`, spreads, `'x' in props` now work); imperative
  `updateProps` before mount respects last-write-wins against reactive
  emissions.
- `packages/node` — `bindSharedBuffer`'s timeout removes its `parentPort`
  listener; `persistSharedMemory().stop()` before `ready` no longer leaks
  the flush timer, and a failing final flush warns instead of rejecting.
- `examples/nextjs` — `GET /api/incidents/:id` returns 503 until the seed
  completes (a valid id no longer serves a zeroed record), and a failed
  seed run can actually be retried (the cached promise is cleared on
  rejection).

### Examples & docs

- `examples/nextjs` — real job-queue (`/api/jobs`) and read-model
  (`/api/incidents`, incl. `GET /:id` over `readAt`) routes, a
  `globalThis`-cached pool/memory seam per route dir, and
  `src/instrumentation.ts` boot warmup that seeds data and computes
  aggregates before the first request.
- `examples/react-dom-worker` — every framework shell (`react-shell.html`,
  `angular-shell.ts`, `solid-shell.ts`, `vue/Shell.vue`,
  `svelte/Shell.svelte`) now mounts the same framework-native island set —
  counter ×2 on a shared client, a notes composer, and a 1,000,000-record
  incident benchmark virtualized inside the target framework running in the
  worker (the heavy-component offload case). Real `.vue`/`.svelte`
  components in the worker entries, a React registry worker
  (`react.worker.tsx`) plus a `lazyIsland` contract module
  (`incidents.island.ts`) — all validated by per-shell e2e tests.
- `examples/react-dom-worker` Vue shell demonstrates all three mount
  styles — `<AtollIsland>` (counters on a shared client),
  `islandComponent` (notes — attrs as props), `lazyIsland` over a contract
  module (incidents — `src/vue/incidents.island.ts` carries its own
  worker; the dynamic import emits a real split chunk).
- Docs — a Blog section joins the consumer site: posts are authored as
  markdown in `docs/blog/` (optional `date:`/`series:`/`title:` front
  matter) and compiled into statically prerendered pages — one route per
  post, site-styled code blocks and tables. Eleven posts ship initially,
  grouped into series covering the framework's major discussion points:
  "Facades", "Inside Atoll" (shared memory, worker pools, reactivity,
  shared workers), "Islands" (worker rendering, the proxy DOM), and
  "Server-side Atoll" (Node backends, clustering/persistence, NestJS DI),
  plus a standalone deployment post. The sidebar swaps the docs tree for
  the post list on blog pages — series subheads, newest-first — and the
  site switcher and landing page link the internal blog rather than the
  repo file.
- Docs — the Angular/Vue/Solid/Svelte worker-islands pages now embed the
  real shells and workers, the Next.js section gained job-queue /
  read-model / warmup / custom-server sub-pages, a new "Server-side
  workers" page (`#/node-servers`) documents `@atolljs/node` end to end
  (pool + client, socket transfer, gateway routing, `workerHttpPorts`/
  `proxyToWorker`, `withSharedBuffer`/`bindSharedBuffer`), the NestJS page
  gained the housed-API section, and the islands docs document driver-side
  style/prop semantics.
- `examples/react-dom-worker` — dropped the per-island "no React in this
  worker" badges; the island heads now just name the renderer.
- `examples/nestjs` — a dedicated service-facade feature (`src/facade/`):
  `ReportService` demonstrates class-level `@AtollService` (every method
  dispatches, zero dispatch code in the class) consumed by a plain
  `DashboardService` — service→service interop with no atoll imports at
  the consumer. The `reports` pool is message-only and shares the
  incidents buffer via `withSharedBuffer`; routes at `/api/reports/*`.
- Consumer docs — new "Service facades" page under NestJS documenting the
  class-level facade pattern (the backend `islandComponent` analog), with
  the two `@AtollService` forms, a dispatch trace, and an interop-style
  chooser.
- Consumer docs — core topics group under a "Core concepts" sidebar
  section, the site is dark-only, and each page embeds a single live demo:
  the framework-free shell (`index.html`) is the canonical demo on the
  Islands overview rather than a stacked set per page.
- Branding — the logo tagline is now "islands based multithreading"
  (regenerated the full SVG/PNG family: brand, horizontal, compact,
  transparent, and social rasters).

### Tooling

- The project is now MIT-licensed — root `LICENSE` plus a copy in every
  package so each npm tarball carries it; all manifests declare
  `"license": "MIT"`.
- `serve-pages` now stops stale servers on :4174 instead of failing on a
  busy port; `kill-all` shares the same port-listener logic.
- Vitest coverage is enforced (`statements: 95, branches: 85, functions:
  93, lines: 96`) — current suite: 98 files / 725 tests at ~96% statements;
  `@vitejs/plugin-vue` was added so `.vue` SFC worker entries load under
  InProcessWorker.

## 0.1.1

HTTP offload topologies for Node, Redis-backed shared-memory persistence, a
framework-neutral islands core, and a consumer-facing docs pass. No breaking
changes to the 0.1.0 API.

### HTTP offload — `@atolljs/node/http` (new)

Two ways to push real HTTP work into `node:worker_threads` pools:

- **Gateway** — `routeHttpGateway({ server, pool, routes })` matches request
  prefixes on the main-thread listener and proxies them to worker-owned HTTP
  servers (`serveHttp(app, { listen: 0 })` inside the worker announces an
  internal port). Unmatched paths stay on the main listener — one port,
  mixed ownership. `proxyToWorker(options)` is the same machinery as
  connect/express-style middleware for embedding in an existing app.
- **Clustering** — `createHttpCluster({ pool, port, route? })` transfers raw
  accepted sockets (`pauseOnConnect`) to workers unparsed; workers run the
  whole HTTP pipeline. Requires Node ≥ 26 (`SOCKET_TRANSFER_SUPPORTED` is
  the capability flag; the call no-ops with a notice otherwise). Routing is
  per-connection, so it lives on a second listener.
- **WebSockets** — upgrades are matched against the same prefix table and
  tunneled to the owning worker (rawHeaders preserved, `host`/path
  rewritten, sockets spliced — the main thread leaves the data path after
  the handshake). Unmatched upgrades go to a new `onUpgrade` fallback or are
  destroyed, preserving Node semantics. `proxyUpgradeToWorker(options)` is
  the `'upgrade'`-listener sibling of `proxyToWorker` for apps that mount
  middleware themselves. Clustered WS needs no extra API — the whole socket
  transfers.
- **Sticky sessions** — `stickyByAddress()` is a `route` for
  `createHttpCluster`: rendezvous hashing on `remoteAddress` pins a client
  to a worker across *separate* connections (socket.io's polling→upgrade,
  HTTP→WS session flows). Worker loss remaps only that worker's clients.
- **Sharing one contract buffer** — `withSharedBuffer(spawn, getBuffer)` +
  `bindSharedBuffer()` (`@atolljs/node`) hand a pool's `SharedArrayBuffer`
  to message-only worker pools (e.g. HTTP workers reading another pool's
  shared memory without a second INIT handshake).

### Shared-memory persistence — `@atolljs/node/redis` (new)

- `persistSharedMemory(memory, { client, name, key?, syncIntervalMs?,
  fields?, subscriber? })` — mirrors a bound contract into Redis. The local
  `SharedArrayBuffer` stays the synchronous source of truth (the contract
  API can't be async); Redis holds per-field bytes as hash members at
  `{key}:{name}` (field path → base64) as the durable/replicated copy.
- A `syncIntervalMs` poll diffs the per-field **version counters** — the
  same Atomics block `observe()` uses — so there is no hot-path write
  instrumentation. `ready` resolves after `hgetall` restores bytes (with
  version bumps so local waiters fire); `flush()` forces a write;
  `stop()` does a final flush.
- Optional **pub/sub replication** (`subscriber`): dirty fields publish
  `{ src, path, b64 }`; subscribers apply bytes + bump local versions —
  echo-suppressed, last-write-wins per field.
- `redisMemoryAdapter(client, opts)` is the pool-config factory:
  `persistence: redisMemoryAdapter(redis)` on `createNodePool` /
  `AtollModule.registerPool(Async)`. `ioRedisSubscriber` adapts ioredis;
  node-redis's `subscribe(ch, listener)` matches natively. The client
  surface is `hset`/`hgetall`/`publish` on strings — no Redis dependency.
- Core seam: `WorkerPoolConfig.persistence?: (memory) => MemoryPersistence`
  (`{ ready, flush, stop }`) — invoked after bind, stopped inside
  `terminate()`. `SharedMemory` gained adapter-facing `buffer` and
  `fields()` accessors; `WorkerPool` exposes `sharedBuffer` and a `workers`
  snapshot for auxiliary messaging.

### Islands — framework-neutral core

- **React moved out.** The react-reconciler host config now lives in
  `@atolljs/react-island/worker` (`reactIslandApp`,
  `defineReactPolyWorker`/`defineReactMonoWorker`); `@atolljs/islands` ships
  no renderer. `definePolyWorker({ apps })` treats every app shape
  uniformly — `{ imperative: (doc, props) => void }`, a framework helper, or
  `{ mount(ctx) }` returning a handle with `update`/`sync`/`flush`/`dispose`.
- **Slots are an attribute, not a component** — host children project into
  the worker tree via `data-atoll-slot`, renderable by any framework;
  React's `<Slot/>` is sugar over it.
- **`@atolljs/islands/metrics`** — flag-gated proxy-engine instrumentation:
  `proxyMs` (engine sinks) vs `appMs` (framework/adapter residual) vs
  `mainMs` (replay), `opBytes` wire estimates, and `proxyInstanceStats()`
  structural counts (retained nodes, handlers, queue depth). Off by
  default; production pays one predictable branch. Powers the generated
  per-framework benchmark table in the consumer docs.

### Core packaging

- The contract layer vendors a **narrowed zod surface** (`src/contract/zod`)
  — named constructors instead of the `z` namespace, which can't
  property-shake and dragged ~440KB into consumer builds. `mz` output and
  `memory.schemas` are still ordinary zod (classic and mini schemas both
  accepted).

### Examples & docs

- New runnable examples: `examples/express`, `examples/fastify`,
  `examples/hono`, `examples/koa` (framework adapters over a worker pool),
  and `examples/http-offload` (gateway + cluster on one app).
- NestJS example demonstrates **housed APIs** — routes owned entirely
  inside workers, reachable through the gateway or the cluster listener.
- READMEs reworked for npm onboarding; consumer docs
  (`jwhenry3.github.io/atolljs/consumer/`) reorganized — framework sub-pages,
  Islands overview/quickstart/proxy-document pages, per-framework backend
  topics (clustering, gateway routing, WebSockets, persistence), and a
  generated bundle-size/processing-load page.
- 76 test files / 529 tests including real `nest build` → boot → HTTP e2e
  and socket-transfer e2e on Node ≥ 26.

## 0.1.0 — initial release

Typed shared-memory worker pools and worker-rendered UI islands for
TypeScript. The worker file is the contract: `defineWorker` declares the
method surface once, `connectWorker` gives the main thread a typed, lazy
client — and a shared-memory contract can flow live values into UI state
without a single `postMessage` copy. On top of that sits the islands layer:
whole framework apps render inside workers and stream DOM ops to the main
thread.

### Core — `@atolljs/core`

**Worker authoring & clients**

- `defineWorker({ sharedMemory?, methods })` — self-bootstrapping worker
  entry; methods are plain functions or `serviceMethod` units with zod wire
  schemas. Nested `services: { name: { ... } }` namespaces methods as
  `name.method`.
- `connectWorker<typeof worker>({ worker, sharedMemory?, poolSize, … })` —
  typed client proxy over a `WorkerPool`; **lazy spawn** makes it SSR-safe —
  the pool starts on the first call (or `client.start()`), never on import.
- `workerClient(runner)` — wraps any `TaskRunner` you already own in the same
  typed surface. Method proxies are cached, so `client.method` is a stable
  reference safe for `useMemo`/effect deps.

**Pool scheduling & lifecycle**

- Least-busy dispatch, per-worker `concurrency`, FIFO queue with `maxQueue`
  backpressure (`PoolQueueFullError`).
- Per-call cancellation and timeouts: `client.with({ signal, timeout })`.
  In-flight aborts reject the caller immediately (`TaskAbortedError`) while
  the worker's slot stays occupied until its late reply arrives — no
  double-booking.
- Worker crash → in-flight calls reject (`WorkerCrashedError`), worker
  respawns (`respawn: false` shrinks the pool instead). `taskTimeout` default
  with per-call override (`TaskTimeoutError`).
- `pool.stats()` — worker/queue/in-flight counts plus wait & run aggregates;
  `pool.close()` drains then terminates; `terminate()` is immediate.

**Shared memory — opt-in, not required**

- `defineSharedMemory({ field.number(), field.string({ schema }), … })` — one
  declaration is simultaneously the binary layout, the zod validator, and the
  TypeScript type. `mz` schemas (`mz.u32()`, `mz.int(min,max)`,
  `mz.string(bytes)`, `mz.object`, `mz.array`) pick the narrowest fixed-width
  storage; `field.list` lays out fixed-size record arrays (`readAt`/`writeAt`/
  `commit`); `maxBytes` stays as the codec escape hatch for dynamic values.
- Versioned fields: every write bumps an atomic version counter; `observe()`
  parks on `Atomics.waitAsync` (poll fallback) — workers write in place and
  the UI updates with zero message copies.
- Omit `sharedMemory` entirely and the pool is a typed, pooled, cancellable
  worker RPC — bare `INIT` handshake, no `SharedArrayBuffer`, **no COOP/COEP
  headers required**.
- Codecs `jsonCodec`/`msgpackCodec`/`msgpackrCodec`; pluggable storage via
  `registerConnectorFactory` and per-contract `plugins`; `MemoryManager` for
  manual buffer allocation.

**Explicit service layer** (what `defineWorker`/`connectWorker` build on)

- `defineService` / `implementService` / `createClient` / `serviceMethod` /
  `rpc<A, R>` — contract objects both threads can hold at runtime; wire ids
  derive as `service.method`; signatures infer from schemas.

**SharedWorker** — `connectSharedWorker` + `sharedWorkerHost`: one worker
(and one buffer) shared across tabs/iframes.

**Testing** — `InProcessWorker`
(`@atolljs/core/testing/inProcessWorker`) runs the whole protocol
in-process: real task registry, real op stream, real shared-memory binding —
only the thread boundary is faked.

### Islands — worker-rendered UI

**`@atolljs/islands`** — the engine. Main thread: `connectIslandWorker({
worker })` + `mountIsland()` — no framework code on the main thread, just op
replay. Worker side (`@atolljs/islands/worker`): `definePolyWorker({ apps })`
hosts a named island registry in one worker; `defineMonoWorker(app)` dedicates
a worker to a single app.

- `islandApp(...)` stamps worker-side apps; `emit` sends events island → host;
  `callbackProp(fn)` marshals function props as emit-backed callables; `Slot`
  projects host children into the worker tree.
- Op stream rides a shared-memory doorbell (`push`) or plain postMessage
  (`mode: 'poll'` / `doorbell: false` — no `SharedArrayBuffer` needed);
  `mountTimeout` guards against silent worker entries.
- `installDomShim(doc)` sets `globalThis.document` + a `window` facade so
  real DOM-dependent libraries run unmodified in the worker: `innerHTML`
  parses via htmlparser2, delegated `listen` ops, `outerHTML`,
  `insertAdjacentHTML`, `cloneNode`, `closest`/`matches`, and friends on the
  proxy DOM.

**Per-framework island packages** — each ships a host-side mount and worker
helpers (`define<Fw>PolyWorker` / `define<Fw>MonoWorker`):

| Package | Host API |
|---|---|
| `@atolljs/react-island` | `<Island/>`, `islandComponent`, `lazyIsland` (Suspense code-splitting) |
| `@atolljs/vue-island` | `<AtollIsland/>`, `useIsland`, `islandComponent`, `lazyIsland` |
| `@atolljs/svelte-island` | `<AtollIsland/>` component, `svelteIsland` |
| `@atolljs/solid-island` | `createIsland`, `Island`, `islandComponent`, `lazyIsland` |
| `@atolljs/angular-island` | `<atoll-island>` component + `[atollIsland]` directive |

### Framework bindings — independently published

| Package | API |
|---|---|
| `@atolljs/react` | `useObservable`, `useSharedValue`, `useTask` |
| `@atolljs/vue` | `useObservable`, `useSharedValue`, `useTask` |
| `@atolljs/solidjs` | `createObservable`, `createSharedValue`, `createTask` |
| `@atolljs/svelte` | `observableValue`, `sharedValue`, `taskState` (runes) |
| `@atolljs/angular` | `observableSignal`, `sharedValue`, `taskState` (signals), `provideAtoll`, `injectAtollPool` |
| `@atolljs/nextjs` | React hooks re-exported for App Router client components |

Every task binding accepts an `AsyncTask` **or a plain async function** — a
client method like `useTask(incidents.queryIncidents)` binds directly, with
per-call-site task state (no module-global latest-wins clobbering).

**Angular** also ships `AtollModule` — the Nest vocabulary for NgModule apps:
`forRoot`/`forRootAsync` at the root, `registerPool`/`registerPoolAsync`
inside the feature module that owns the worker, `@InjectAtollPool` for
ctor-param injection. Pools terminate on injector destroy (teardown/HMR).

### Server side

- `@atolljs/node` — `createNodePool` (auto-adapts
  `node:worker_threads.Worker`), `createNodeWorker`, the `/shim` worker entry
  (`self = parentPort`). No isolation headers needed on Node.
- `@atolljs/nestjs` — `AtollModule.forRoot/forRootAsync` +
  `registerPool/registerPoolAsync` (feature-module-owned pools, Bull-style);
  `@AtollService({ pool })` class-level and `@AtollTask` method-level offload —
  bodies run inside the worker's own Nest context on DI-resolved providers;
  `runAtollWorker(AppModule)` is the entire worker entrypoint; worker-side
  guard prevents nested pools when feature modules are shared between
  API and worker contexts.

### Packaging

- Per-module `dist` (not a monolith) — dependencies (`zod`, `msgpackr`,
  `@msgpack/msgpack`, `solid-js`) are external so bundlers tree-shake unused
  parts; deep imports reach the TypeScript sources via the `./*` export.
- `workerBootstrap` is marked side-effectful so bundlers keep its
  `self.onmessage` wiring.
- Releases stage to npm (`npm stage publish`) for maintainer-approved,
  provenance-attested publishing — OIDC trusted publishing supported
  (`npm trust github … --allow-stage-publish`), so the workflow can run
  secretless and stage-only.

### Requirements & caveats

- Browser `Worker` (or `node:worker_threads`); `SharedArrayBuffer` +
  `crossOriginIsolated` only when `sharedMemory` is used (islands run
  headerless in `poll` mode).
- Safari lacks `SharedWorker` — feature-detect before `connectSharedWorker`.
- Bindings ship TypeScript source; your bundler compiles them. Works with
  TypeScript 6 and 7.
- Single-writer field semantics — multi-writer coordination is on you
  (`Atomics.compareExchange` or a designated writer).

### Ecosystem in the box

- Consumer docs + live demos at `jwhenry3.github.io/atolljs/consumer/` —
  a `coi-sw.js` service worker injects COOP/COEP on headerless hosts so the
  demos run in `push` mode, with automatic `poll` fallback; in-repo agent/
  developer docs live under `docs/`.
- Runnable examples for all six frameworks + NestJS + Node, an `incidents`
  domain package as the reference integration, and a worker-DOM islands demo
  (React + Vue + imperative islands in one page).
- 66 test files / 478 tests including a real `nest build` → boot → HTTP e2e.
### Requirements & caveats

- Browser `Worker` (or `node:worker_threads`); `SharedArrayBuffer` +
  `crossOriginIsolated` only when `sharedMemory` is used (islands run
  headerless in `poll` mode).
- Safari lacks `SharedWorker` — feature-detect before `connectSharedWorker`.
- Bindings ship TypeScript source; your bundler compiles them. Works with
  TypeScript 6 and 7.
- Single-writer field semantics — multi-writer coordination is on you
  (`Atomics.compareExchange` or a designated writer).

### Ecosystem in the box

- Consumer docs + live demos at `jwhenry3.github.io/atolljs/consumer/` —
  a `coi-sw.js` service worker injects COOP/COEP on headerless hosts so the
  demos run in `push` mode, with automatic `poll` fallback; in-repo agent/
  developer docs live under `docs/`.
- Runnable examples for all six frameworks + NestJS + Node, an `incidents`
  domain package as the reference integration, and a worker-DOM islands demo
  (React + Vue + imperative islands in one page).
- 66 test files / 478 tests including a real `nest build` → boot → HTTP e2e.
