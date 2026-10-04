# @atolljs/devtools

Devtools transport + analytics dashboard for AtollJS instrumentation events:
pool lifecycle, task timings, worker crashes/respawns, shared-memory field
writes, and island op traffic — streamed from the app to a standalone server
and rendered by a bundled dashboard.

The dashboard is a multi-view analytics site (dependency-free static app in
`app/`):

- **Dashboard** — sub-tabs: *Overview* (the **app map** — one world-space
  canvas holding every live session as an atoll cluster: main thread at
  the center, pool sockets on the rim, workers on the mid orbit, islands
  on the outer orbit rendered as framework marks — React ⚛, Vue V,
  Svelte S, Angular A, Solid, vanilla JS, per the `framework` tag the
  mounter declares. Wheel to zoom, drag to pan, double-click to refit;
  zoom tiers apply clustering — sessions collapse to labeled discs, mid
  zoom collapses islands into a green pool ring; click a node to inspect,
  click a session disc/center to drill in) plus KPI cards, per-second
  task-throughput chart, and an "attention needed" feed. *Pools*,
  *Workers*, *Islands*: the entity tables — pools (size, memory, worker
  count, tasks, failures), workers (tasks, failures, respawns, errors,
  heap, hosted islands, last task, live/down), islands (app, framework,
  pid, host `poolN#0` cross-link, round-trips, op batches, replay ms,
  events, live/unmounted). *Worker* / *Island*: the inspector sub-tabs,
  appearing on row or map-node click — worker inspector (own waterfall
  lane, live heap chart, that worker's fetches, task history, error
  log), island inspector (framework badge, op-traffic chart, per-call
  aggregates, event-channel breakdown, round-trip table). Island and
  worker inspectors are cross-linked — `island:mount` carries the
  client's `poolId`.
- **Tasks** — a waterfall/flame view: one swimlane per pool worker slot,
  queued→dispatched→settled segments colored by outcome, hover tooltips;
  per-task aggregates (n, failures, wait/run avg, run p95/max) with
  click-to-drill filtering of the waterfall and the per-call table.
- **Network** — two sub-tabs. *Traffic*: rolling 60s charts (tasks/s,
  avg run ms, errors/s, in-flight calls, island ops/round-trips/events
  per second, fetches/s) plus a **fetch log** of real `fetch()` traffic
  from main thread and workers. *Request* (click a fetch row): request/
  response headers, capped body previews, sizes (transfer/encoded/
  decoded), and a Resource-Timing stage breakdown (stalled, dns, tcp,
  tls, request+waiting, download). Cross-origin responses without
  `Timing-Allow-Origin` show total time only.
- **Memory** — two sub-tabs. *Shared-memory writes*: field-writes/s and
  top-fields/s charts plus the per-field table (writes, writes/sec,
  version, last writer `poolId#slot` when worker-forwarded, rate
  sparkline). *JS heap*: per-execution-context heap via
  `performance.measureUserAgentSpecificMemory` — worker heaps identified
  by worker script URL.
- **Log** — the raw event stream.

Sessions are pages/processes; a disconnected session is retained (bounded)
as an **ended** session so its history stays attributed for post-mortem
analysis — its rows are grayed and excluded from live KPIs. Hover an ended
session in the sidebar and click **×** to dismiss it: the server drops it
from the session list and purges its replayed batches, so it stays gone for
current and future viewers. Live sessions can't be dismissed.

## Surface

| Import | Purpose |
|---|---|
| `@atolljs/devtools` | `connectDevtools({ transport?, url?, session?, flushMs?, bufferCap?, replayBatches?, network?, memory? })` — installs the core event sink and batches events to dashboards. Default `transport: 'auto'`: **BroadcastChannel** in a browser window (pure client — no backend; the dashboard is served on the app's own origin at `/__atoll/` by the vite plugin, and `mountDevtoolsOverlay()` embeds it in a floating flyout — draggable, resizable, `position` option), WebSocket to the aggregate server everywhere else (`url` or `transport: 'websocket'` opts in — Node uses this path). `network` (default on) wraps `fetch` to emit `net:fetch` per request; `memory` (default on) samples JS heap into `runtime:memory`. |
| `@atolljs/devtools/node` | Node entry — `initDevtools`/`connectDevtools` without the browser-only pieces (WebSocket-only, env-gated, no overlay). Use this import in Node apps. |
| `@atolljs/devtools/server` | `createDevtoolsServer({ port?, host?, appDir?, replayBatches? })` — Node http + dependency-free WebSocket server on `127.0.0.1` (default port 4780). |
| `atoll-devtools` bin | Boots the server and prints the dashboard URL. `atoll devtools` resolves it through the CLI too. |

## Usage

```bash
npx atoll-devtools          # or: atoll devtools [--port 4780]
```

The quickest wire-up in an existing app is the scaffolder —
`atoll add devtools` writes the right init module for your host (browser,
Node, or the Angular aggregate-server variant) and installs the package.
Or by hand:

```ts
// in the app — one line. No-op unless the URL carries ?__atoll_devtools:
// then the BroadcastChannel sink installs and the overlay flyout mounts.
// Call before pools spawn: worker-side events forward only if the sink
// existed at INIT time.
import { initDevtools } from '@atolljs/devtools';
initDevtools({ session: { name: 'my-app' } });

//   my-app/?__atoll_devtools  → devtools on
//   my-app/                   → zero cost, no sink installed
//
// Always-on or programmatic control: `connectDevtools(opts)` ignores the
// param; `initDevtools({ enabled, overlay })` overrides the gate.
```

## Node apps (Express, NestJS, …)

Node takes the WebSocket path automatically — no `window`, so no
BroadcastChannel — pointed at the standalone server, which is also the
dashboard:

```bash
npx atoll-devtools          # http://127.0.0.1:4780
```

```ts
// src/devtools.ts — a dedicated module, imported FIRST from the entry.
// No-op unless ATOLL_DEVTOOLS is set in the environment.
import { initDevtools } from '@atolljs/devtools/node';
initDevtools({ session: { name: 'my-api' } });
```

```ts
// main.ts — the import order matters: ESM evaluates imports before the
// body, and pools usually spawn inside a sibling module or NestFactory.
import './devtools';
```

```bash
ATOLL_DEVTOOLS=1 npm run start
```

- Works on any Node — the client uses the global `WebSocket` on ≥ 22 and
  falls back to a bundled dependency-free client (`src/nodeWs.ts`) below it.
- Inbound HTTP is not instrumented — `net:fetch` covers the `fetch()` calls
  your app *makes*, on the main thread and inside workers.
- `runtime:memory` comes from `process.memoryUsage()` in Node — per-worker
  heap columns fill for `worker_threads` pools.
- No overlay, no `/__atoll/` — Node sessions appear on the aggregate
  dashboard as `runtime: 'node'` alongside any browser apps pointed at the
  same server.
- See `examples/express` and `examples/nestjs` for the wiring.

- Worker-side events reach the sink automatically: pools pass a
  `devtools` flag in INIT, workers forward `ATOLL_DEVTOOLS` messages back
  over the task channel, and the pool stamps each with
  `worker: {poolId, slot}` — so `memory:write`, `net:fetch`, and worker
  heap samples attribute to a specific worker. Only active when a sink
  was installed before the spawn.
- `net:fetch` covers `fetch()` on the main thread (via the probe
  `connectDevtools` installs) and inside workers (probed when forwarding
  is enabled). XHR is not covered.
- `runtime:memory` uses Chrome's `performance.measureUserAgentSpecificMemory`
  on the main thread (cluster breakdown — every worker context listed by
  its script URL), `performance.memory` where available, and
  `process.memoryUsage()` on Node (heapUsed + RSS — also inside
  `worker_threads`, so per-worker heap columns populate for Node pools).
- Zero cost when unused: `emitDevtools` is one branch without a sink, and
  `connectDevtools()` is the only thing that installs one.
- Events buffered while the socket connects are capped (50k, oldest
  dropped); batches flush every 100ms.

## Wire protocol

JSON text frames. Apps → server on `/events`: `{type:'hello', session}`
then `{type:'batch', events[]}`. Dashboards → server on `/view`:
`{type:'sessions'}` then `{type:'batch', session, events}` fan-out, with a
bounded tail replayed to late joiners. See `src/protocol.ts`.
