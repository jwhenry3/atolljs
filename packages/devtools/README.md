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
| `@atolljs/devtools` | `connectDevtools({ url?, session?, flushMs?, bufferCap?, network?, memory? })` — installs the core event sink and batches events over WebSocket. Browser and Node ≥22 (global `WebSocket`). `network` (default on) wraps `fetch` to emit `net:fetch` per request; `memory` (default on) samples JS heap into `runtime:memory`. |
| `@atolljs/devtools/server` | `createDevtoolsServer({ port?, host?, appDir?, replayBatches? })` — Node http + dependency-free WebSocket server on `127.0.0.1` (default port 4780). |
| `atoll-devtools` bin | Boots the server and prints the dashboard URL. `atoll devtools` resolves it through the CLI too. |

## Usage

```bash
npx atoll-devtools          # or: atoll devtools [--port 4780]
```

```ts
// in the app — one line, then everything is streamed.
// Call before pools spawn: worker-side events forward only if the sink
// existed at INIT time.
import { connectDevtools } from '@atolljs/devtools';
connectDevtools({ session: { name: 'my-app' } });
```

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
  its script URL) and `performance.memory` where available (main thread
  only in Chrome — per-worker heap columns/charts populate on engines
  that expose it inside workers).
- Zero cost when unused: `emitDevtools` is one branch without a sink, and
  `connectDevtools()` is the only thing that installs one.
- Events buffered while the socket connects are capped (50k, oldest
  dropped); batches flush every 100ms.

## Wire protocol

JSON text frames. Apps → server on `/events`: `{type:'hello', session}`
then `{type:'batch', events[]}`. Dashboards → server on `/view`:
`{type:'sessions'}` then `{type:'batch', session, events}` fan-out, with a
bounded tail replayed to late joiners. See `src/protocol.ts`.
