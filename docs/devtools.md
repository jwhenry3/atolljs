# @atolljs/devtools — instrumentation, transports, and the dashboard

Read when: touching `packages/devtools/`, the `emitDevtools`/sink seam in
`src/devtools.ts`, worker `ATOLL_DEVTOOLS` forwarding in
`src/worker/workerBootstrap.ts` / `src/pool/workerPool.ts`, or the
`/__atoll/` mount in `packages/vite/`.

The user-facing surface (options, views, URL gate) lives in
`packages/devtools/README.md` and the consumer docs site. This doc covers
the architecture and the invariants that are easy to break.

## Architecture in one paragraph

Core instrumentation never transports anything itself. `src/devtools.ts`
exposes a **sink seam**: `emitDevtools(event)` is one branch on a module
sink; `connectDevtools()` is the only production code that installs one.
Transports are pluggable sink implementations — BroadcastChannel (browser
default) and WebSocket (aggregate server / Node) produce identical event
streams. The dashboard (`packages/devtools/app/`, a dependency-free static
site) renders whichever stream it hears. Workers never own a transport:
they wrap each event in an `ATOLL_DEVTOOLS` postMessage on the existing
task channel and the main thread re-emits through its sink.

## Transport selection

`connectDevtools()` defaults to `transport: 'auto'`:

- **Browser window → BroadcastChannel** (`src/broadcast.ts`, channel
  `atoll-devtools`). Pure client — no backend. Same-origin isolation is
  structural: a dashboard can only see apps on its own origin, which is
  the product answer to "don't aggregate foreign app instances". Each app
  keeps a bounded batch tail (500) in memory and answers viewer `view`
  pings with re-`hello` + replay, so late-joining dashboards still get
  history. `bye` on `pagehide` ends the session.
- **Node / `url` / `transport: 'websocket'` → `/events` WebSocket** to the
  standalone server (`src/server.ts`, loopback, default port 4780). This
  is the *opt-in aggregate*: cross-origin apps, Node processes, and
  post-mortem retention that outlives the page.

The dashboard picks the mirror side: `window.__ATOLL_TRANSPORT ===
'broadcast'` (injected by the vite plugin when serving `index.html`)
means it builds the session registry from channel frames itself —
hello→live, bye→ended — and owns pins/dismiss/TTL locally. Otherwise it
connects to `/view` and the server owns everything.

## Invariants

- **`?__atoll_devtools` is the whole gate.** `initDevtools()` returns
  `null` without it — no sink, no broadcast, no overlay button, no worker
  forwarding, no fetch/memory probes. The `enabled` option overrides.
  `connectDevtools()` ignores the param (always-on low-level API). Node
  gates on the `ATOLL_DEVTOOLS` env var.
- **Call `initDevtools()` before pools spawn.** The pool stamps
  `devtools: devtoolsEnabled()` into each worker's INIT handshake;
  `enableWorkerDevtoolsForwarding()` runs only when that flag is true.
  Workers spawned before a sink existed never emit — by design (the flag
  is also what keeps disabled workers fully quiet: no sink, no probes,
  no `ATOLL_DEVTOOLS` messages on the wire).
- **One transport per app, never per worker.** Worker events ride the
  task channel back to the main thread (`forwardDevtools` stamps
  `worker: {poolId, slot}`), which is why a `poolSize: 32` pool still
  costs one broadcast/socket and why the event stream is single-ordered
  for the timeline views. Do not give workers their own connection.
- **`devtoolsEnabled()` guards hot-path event construction.**
  `memory:write` fires on every shared-memory commit — the call sites in
  `src/contract/sharedMemory.ts` check `devtoolsEnabled()` before
  building the event object, not just rely on the sink no-op. Keep that
  pattern for any event emitted at write-rate frequency; pool task
  events (bounded by RPC throughput) still allocate before the no-op.
- **The `/__atoll/` iframe needs the app's COOP/COEP.** The vite
  middleware echoes `server.config.server.headers` on `/__atoll/`
  responses — without COOP `same-origin` the flyout iframe lands in a
  separate browsing-context group and `contentDocument` is `null` (the
  same rule the worker middleware follows; see
  [cross-origin-isolation.md](cross-origin-isolation.md)).
- **`@atolljs/devtools` resolves through `pluginContainer.resolveId`**
  in the vite plugin, not `createRequire` alone — workspace consumers
  reach the package via vite alias, and node resolution misses it (the
  failure mode is `/__atoll/` silently falling through to the SPA
  fallback and serving the app inside its own flyout).
- **BroadcastChannel is per-origin by spec** — that *is* the scoping.
  Don't add app/session filtering to compensate; multiple tabs of the
  same app legitimately appear as separate sessions.

## Dashboard app (`app/`)

Static `index.html` + `main.js`, no build step, no dependencies.

- `?mini=1` → `body.mini`: hides the session sidebar/`#scope`, session
  columns and group rows, compacts tables — and reparents the map block
  into a dedicated `tv-map` sub-tab (inserted before the generic subnav
  binding so it gets the standard handler; default tab). The map canvas
  flex-fills the tab.
- `body.local` (any broadcast context, mini or full) hides the session
  machinery — broadcast mode is structurally single-origin.
- The app map is one canvas: session disc → pools inner orbit → workers
  mid orbit → islands outer orbit as framework marks; zoom tiers keep
  island marks on the rim (the atoll-logo look). `state.inspect`,
  `state.inspectWorker`, `state.sel` drive the accent-ring highlight;
  every selection path ends in `render()` → `drawAppMap` so the ring
  paints immediately.
- Framework icons are drawn once via `drawFwMark` into offscreen
  canvases → cached data URLs → `<img class="fwicon">` everywhere tables
  need an icon. One icon implementation feeds map + tables — don't fork
  it.

## Node apps

Node takes the WebSocket path by construction — `autoBroadcast()` requires
`window.document`, and a `worker_threads.BroadcastChannel` would only scope
to the same process anyway. There is no `/__atoll/` page or overlay: the
standalone server (`npx atoll-devtools`) is the dashboard.

- **Gate**: `initDevtools()` checks `process.env.ATOLL_DEVTOOLS` when there's
  no `location` — `ATOLL_DEVTOOLS=1 npm run start` enables, anything else is
  a no-op. `connectDevtools()` stays the always-on API. Node apps import
  from `@atolljs/devtools/node` (`src/node.ts`) — same API minus the
  browser-only surface, so browser bundlers/tsconfigs never see `node:*`
  (the `nodeWs` fallback loads through a computed dynamic import for the
  same reason).
- **Init order**: put `initDevtools()` in a module imported *first* from the
  entry (`import './devtools'`), not in the entry body — in Node apps the
  pool typically spawns inside a sibling module's top-level code (see
  `examples/express/src/devtools.ts` + `main.ts`), and ESM evaluates all
  imports before the entry body runs. Nest pools spawn inside
  `NestFactory.create`, so the same pattern works there
  (`examples/nestjs/src/devtools.ts`).
- **WebSocket**: the client uses the global `WebSocket` (Node ≥ 22). On
  older Node it lazily loads `src/nodeWs.ts` — a dependency-free RFC6455
  client (masked frames out, `decodeFrames` shared with the server) — so
  `node:net`/`node:crypto` never enter browser bundles. If neither exists
  the sink installs but stays dead.
- **Memory**: `installMemoryProbe` falls back to `process.memoryUsage()`
  when `performance.memory`/`measureUserAgentSpecificMemory` are absent —
  emits `heapBytes` (heapUsed) + `rssBytes`, and works inside
  `worker_threads`, so per-worker heap columns populate for Node pools.
- **Coverage**: `net:fetch` is outbound `fetch()` only — inbound HTTP
  handled by Express/Nest/worker-housed APIs is not instrumented. Islands
  never appear (nothing renders in Node).

## Server-side session lifecycle (`server.ts`)

`closedAt` stamps on socket close; a sweep (default 60s, `sweepMs`)
evicts closed sessions older than `closedTtlMs` (30 min) — removed from
`closedSessions` *and* replay tail purged, then the list rebroadcasts.
`pinned` sessions are exempt from both the TTL and the 20-session cap
(the cap evicts oldest unpinned first). Viewers toggle via
`{type:'pin', sessionId, pinned}`; pins are server-authoritative and fan
out through the `sessions` broadcast. In broadcast mode the dashboard
implements the same rules client-side.

## Wire protocol

JSON frames (`src/protocol.ts`). App→server on `/events`:
`{type:'hello', session}` then `{type:'batch', events[]}`. Viewer→server
on `/view`: `{type:'sessions'}` then `{type:'batch', session, events}`
fan-out plus `{type:'dismiss'}`/`{type:'pin'}` requests. BroadcastChannel
mode reuses the same frame shapes minus the socket.
