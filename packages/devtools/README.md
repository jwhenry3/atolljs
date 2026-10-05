# @atolljs/devtools

Devtools transport + analytics dashboard for AtollJS instrumentation events:
pool lifecycle, task timings and message cost, worker crashes/respawns,
shared-memory field writes and live values, island op traffic, props and
DOM, main-thread jank, reactivity, and SDK logs. Events stream from the app
to a dashboard (same-origin BroadcastChannel, or the standalone server), and
the dashboard can send commands back: kill a worker, inject faults, edit
island props, set shared-memory watchpoints.

The dashboard is a dependency-free static app in `app/`. Its views are
described in the [Views reference](#views-reference) below.

Sessions are pages/processes; a disconnected session is retained (bounded)
as an **ended** session so its history stays attributed for post-mortem
analysis: its rows are grayed and excluded from live KPIs. Hover an ended
session in the sidebar and click **×** to dismiss it: the server drops it
from the session list and purges its replayed batches, so it stays gone for
current and future viewers. Live sessions can't be dismissed.

## Surface

| Import | Purpose |
|---|---|
| `@atolljs/devtools` | `connectDevtools({ transport?, url?, session?, flushMs?, bufferCap?, replayBatches?, network?, memory?, jank? })`: installs the core event sink and batches events to dashboards. Default `transport: 'auto'`: **BroadcastChannel** in a browser window (pure client, no backend; the dashboard is served on the app's own origin at `/__atoll/` by the vite plugin in dev, and emitted into `vite build` output whenever the app bundles devtools), WebSocket to the aggregate server everywhere else (`url` or `transport: 'websocket'` opts in; Node uses this path). `session` is `{ name?, hint?, framework? }`. `network` (default on) wraps `fetch` to emit `net:fetch` per request; `memory` (default on) samples JS heap into `runtime:memory`; `jank` (default on) installs the main-thread jank probe (`runtime:longframe`, `runtime:frames`). |
| `@atolljs/devtools` | `initDevtools({ enabled?, overlay?, ...connectOptions })`: the URL-gated one-liner (`?__atoll_devtools`), connects and mounts the overlay. |
| `@atolljs/devtools` | `mountDevtoolsOverlay({ src?, startOpen?, width?, height?, position?, persist?, hotkey? })`: the floating flyout (draggable, resizable). `persist` (default `true`, or a localStorage key, default `'atoll-devtools:overlay'`) remembers position, size and open state; `hotkey` (default `'Alt+Shift+D'`, `false` disables) toggles it. |
| `@atolljs/devtools/node` | Node entry: `initDevtools`/`connectDevtools` without the browser-only pieces (WebSocket-only, env-gated, no overlay). Use this import in Node apps. |
| `@atolljs/devtools/server` | `createDevtoolsServer({ port?, host?, appDir?, replayBatches?, closedTtlMs?, sweepMs? })`: Node http + dependency-free WebSocket server on `127.0.0.1` (default port 4780). |
| `@atolljs/devtools/otel` | `exportOtel({ endpoint?, headers?, serviceName?, resource?, signals?, flushIntervalMs?, maxBatch?, maxQueue?, maxSeries?, onError?, network?, memory?, jank? })`: dependency-free OTLP/HTTP JSON exporter (traces, metrics, logs) to any OpenTelemetry backend; returns `{ flush(), close() }`. Install before pools spawn. See [OpenTelemetry export](#opentelemetry-export). |
| `atoll-devtools` bin | Boots the server and prints the dashboard URL. `atoll devtools` resolves it through the CLI too. `--otlp <url>` also forwards every session to an OTLP endpoint. |

## Usage

```bash
npx atoll-devtools          # or: atoll devtools [--port 4780]
```

The quickest wire-up in an existing app is the scaffolder:
`atoll add devtools` writes the right init module for your host (browser,
Node, or the Angular aggregate-server variant) and installs the package.
Or by hand:

```ts
// in the app, one line. No-op unless the URL carries ?__atoll_devtools:
// then the BroadcastChannel sink installs and the overlay flyout mounts.
// Call before pools spawn: worker-side events forward only if the sink
// existed at INIT time.
import { initDevtools } from '@atolljs/devtools';
// `framework` (optional) puts the shell's mark on the map's main-thread hub.
initDevtools({ session: { name: 'my-app', framework: 'react' } });

//   my-app/?__atoll_devtools  → devtools on
//   my-app/                   → zero cost, no sink installed
//
// Always-on or programmatic control: `connectDevtools(opts)` ignores the
// param; `initDevtools({ enabled, overlay })` overrides the gate.
```

## Node apps (Express, NestJS, …)

Node takes the WebSocket path automatically (no `window`, so no
BroadcastChannel), pointed at the standalone server, which is also the
dashboard:

```bash
npx atoll-devtools          # http://127.0.0.1:4780
```

```ts
// src/devtools.ts: a dedicated module, imported FIRST from the entry.
// No-op unless ATOLL_DEVTOOLS is set in the environment.
import { initDevtools } from '@atolljs/devtools/node';
initDevtools({ session: { name: 'my-api' } });
```

```ts
// main.ts: the import order matters. ESM evaluates imports before the
// body, and pools usually spawn inside a sibling module or NestFactory.
import './devtools';
```

```bash
ATOLL_DEVTOOLS=1 npm run start
```

- Works on any Node: the client uses the global `WebSocket` on ≥ 22 and
  falls back to a bundled dependency-free client (`src/nodeWs.ts`) below it.
- Inbound HTTP is not instrumented: `net:fetch` covers the `fetch()` calls
  your app *makes*, on the main thread and inside workers.
- `runtime:memory` comes from `process.memoryUsage()` in Node: per-worker
  heap columns fill for `worker_threads` pools.
- No overlay, no `/__atoll/`, no jank probe (it is browser main thread
  only): Node sessions appear on the aggregate dashboard as
  `runtime: 'node'` alongside any browser apps pointed at the same server.
- See `examples/express` and `examples/nestjs` for the wiring.

## Views reference

The nav runs Dashboard, Tasks, Performance, Network, Memory, Reactivity,
Audits, Log. Each view opens with a one-line intro (dismissible; "Show view
intros again" in the palette brings them back). Views scope to the session
selected in the sidebar, or every session when none is.

### Dashboard

The **app map** sits above the sub-tabs: one world-space canvas holding
every live session as an atoll cluster. The main thread is at the center
(carrying the shell's framework mark when `session.framework` is set), pool
sockets (P) on the inner orbit, workers on the outer orbit. A worker
hosting one island is drawn *as* that island, as its framework mark
(React, Vue, Svelte, Angular, Solid, or vanilla JS, per the `framework` tag
the mounter declares or the renderer the worker reports). A worker shared by
several islands is a ring with a W badge and one node per instance inside. A
plain worker, or an untagged lone island, is a W. Nested sub-workers hang
off the instance (or worker) that spawned them on a violet link. Wheel to
zoom, drag to pan, double-click to refit and back out to every session;
click a node to inspect it, click a session disc to drill into that
session. Fed by `pool:init`, `worker:spawn`, `island:mount`.

- **Overview**: KPI cards (live pools, tasks settled, error rate, run p95
  and max, field writes, islands, workers), the per-second **task
  throughput** chart (last 60s, with latest, peak, average, total and
  failures), and an **Attention needed** feed of worker respawns, worker
  errors, and failed task settles.
- **Pools / Workers / Islands**: the entity tables. Pools: size, memory,
  worker count, tasks, failures. Workers: tasks, failures, respawns, errors,
  heap, hosted islands, last task, live/down. Islands: app, framework, pid,
  host `poolId#slot` cross-link, round-trips, op batches, ops, replay ms,
  events, live/unmounted. Click a row to open its inspector.
- **Worker** (inspector, appears on a worker click): KPIs, the worker's own
  task lane (click a segment to drill Tasks to that task id), its last 150
  tasks, a live heap chart, its last 50 fetches, and its error log. With a
  live session that exposes the commands, the inspector also carries the
  **Kill worker** button and the **Chaos** form (see
  [Live controls](#live-controls)).
- **Island** (inspector, appears on an island click): KPIs (round-trips,
  avg/max round-trip ms, ops applied, replay ms, emits, host heap, failed
  calls), an op-traffic chart colored by call, per-call aggregates, the
  event-channel breakdown, and the last 150 round-trips. Three tabs sit
  above the charts:
  - **Elements**: the island's real DOM as a collapsible tree, fetched with
    `island.tree` (up to 4000 nodes per fetch; Refresh, or auto-refresh every
    2s). Hover a node to outline it in the app page (`island.highlight`,
    with its tag and size); click it for its attributes and text. A nested
    island (`parent~app@N`) shows the top-level island's tree, which holds
    its replayed DOM.
  - **Props**: the `island:props` history (mount plus every `updateProps`,
    last 100), each entry diffed against the previous one by top-level key.
  - **Events**: the `island:event` log (last 500) with payload previews and
    a name filter.

  Island controls (**Edit props**, **Push** / **Poll** mode) sit in the
  inspector header.
- **Map** (flyout only): in the `?mini=1` layout the app map becomes its own
  default sub-tab and fills the view.

### Tasks

A waterfall of every pool task call: one swimlane per worker slot, queue
wait (gray) then run (colored by outcome), with hover tooltips. Below it,
per-task aggregates (calls, failures, wait avg, run avg, run p95, run max;
click a row to drill the waterfall and tables to that task) and the latest
200 calls. Fed by `task:enqueue` / `task:dispatch` / `task:settle`.

### Performance

Main-thread responsiveness and message cost, all on a rolling 60s window.

- **Main thread**: KPIs (long frames, total blocking time, fps now, min fps,
  dropped frames, worst frame) and a timeline of long frames (bar height =
  duration, red when blocking ≥ 100ms) overlaid with one fps line per
  session. Fed by the [jank probe](#jank-probe-and-user-timing).
- **Worst long frames**: the longest retained frames with their top scripts
  from Long Animation Frame attribution (the `longtask` fallback has none).
- **Message cost**: per task id, the estimated clone size of args posted
  (avg, max) and results returned (avg, max); per island, the op-batch size
  (avg, max, total). Fed by `task:dispatch.argBytes`,
  `task:settle.resultBytes`, `island:ops.bytes`.

The nav badge counts long frames in the last 10s.

### Network

- **Traffic**: rolling 60s charts (tasks/s, avg run ms, errors/s, in-flight
  calls, island ops/s, island round-trips/s, island events/s, fetches/s) and
  a **fetch log** of real `fetch()` traffic from the main thread and workers
  (latest 150, attributed to `main` or `poolId#slot`).
- **Request** (click a fetch row): request/response headers, capped body
  previews, sizes (transfer/encoded/decoded), and a Resource Timing stage
  breakdown (stalled, dns, tcp, tls, request+waiting, download).
  Cross-origin responses without `Timing-Allow-Origin` show total time only.

### Memory

- **Values**: live shared-memory field values for one session, read with
  `memory.read` about twice a second while the tab is open; changed cells
  flash. **Snapshot** remembers the current values and a diff column
  compares against them. **Watchpoints** and the watch-hit log sit below
  (see [Watchpoints](#shared-memory-watchpoints)). Needs one live session:
  select it in the sidebar when several are live.
- **Shared-memory writes**: field-writes/s and top-fields/s charts plus the
  per-field table (writes, writes/sec, version, last writer `poolId#slot`
  when worker-forwarded, rate sparkline). Fed by `memory:write`.
- **JS heap**: a per-session heap line and a per-execution-context table
  from `performance.measureUserAgentSpecificMemory` (worker heaps identified
  by worker script URL). Fed by `runtime:memory`.

### Reactivity

The cross-thread dependency graph from `reactive:node` events, laned by
owner: a **shared memory** lane for field sources, then the main thread, then
one lane per worker slot. Edges run dependency to dependent. Node kinds map
onto the SDK's reactivity:

| Kind | What it is |
|---|---|
| source | a shared-memory field, id `mem:<path>`, the same node on every thread |
| bridge | a version-counter watcher (`Atomics.waitAsync`, or the 50ms poll fallback): the part that crosses threads |
| derived | a selector slice of a `watch` / `observe` |
| effect | a `watch` callback, or an `observe` observable's subscriber fan-out |

Click a node for its id, lane, owner, dependencies and dependents. Disposed
nodes fade (toggle **show disposed**). Nodes are emitted only for
subscriptions created while devtools is enabled; **Load snapshot** fetches
the main thread's live nodes (`reactive.nodes`) when the dashboard opened
after the creation events left the replay tail.

### Audits

Live recommendations: pure rules re-run once a second over the selected
sessions' recent data, rendered as cards with a severity, the evidence, a
fix, a docs link, and entity chips that open the matching inspector. Filter
by severity; **mute rule** hides a rule's findings (persisted in
localStorage under `atoll.devtools.audits.muted`). The "What each rule
needs" table lists every rule's input events and whether that data has been
seen. The nav badge counts unmuted errors and warnings.

| Rule | Fires when | Severity |
|---|---|---|
| `coi-islands` | islands are mounted on a page reporting `crossOriginIsolated = false` | warn |
| `large-args` / `large-results` | a task's args / results p95 or average exceeds 64KB (3+ calls in 60s) | warn |
| `island-batch-bytes` | an island's op-batch p95 exceeds 128KB (3+ batches in 60s) | warn |
| `island-slow-replay` | an island's replay p95 exceeds 16ms (3+ batches in 60s) | warn |
| `pool-saturated` | queue-wait p95 over 50ms and over run p95 (20+ dispatches), or a backlog of 20+ that grew by 10+ in 10s | warn |
| `pool-underused` | a pool of 2+ workers below 5% busy over 30s+ of observation, no backlog | info |
| `pool-oversized` | `poolSize` exceeds the session's `hardwareConcurrency` | warn |
| `main-jank` | total blocking time of visible-page frames in 60s reaches 300ms (error at 1000ms) | warn / error |
| `background-work` | script time in hidden-page long frames reaches 1000ms in 60s | info |
| `low-fps` | average fps below 45 over 10s (3+ samples) | warn |
| `task-errors` | a task's error + crashed rate reaches 10% (error at 50%), 5+ settles | warn / error |
| `task-timeouts` | a task's timeout rate reaches 5%, 5+ settles | warn |
| `queue-full` | any `queue-full` settle in 60s | warn |
| `crash-loop` | one slot respawned 3+ times in 60s | error |
| `heap-pressure` | heap / limit reaches 80% (error at 95%), worker or main thread | warn / error |
| `devtools-late` | task events for a pool whose `pool:init` was never seen | warn |
| `memory-write-storm` | one field averages 1000+ writes/s over 5s | warn |
| `fetch-failing` | requests to a method + path failed (network error or status ≥ 400) in 60s | info |
| `fetch-slow` | p95 to response headers over 2000ms (3+ requests) | info |
| `island-untagged` | mounted islands with no framework tag and no reported renderer | info |

Thresholds live as exported constants in `app/panels/audit-rules.js`.
Late-joining dashboards: a pool whose `pool:init` already left the app's
replay tail looks like `devtools-late`, and replayed history is stamped on
arrival, so the whole tail counts as "the last few seconds" for rate rules
until it ages out.

### Log

The raw event stream, one line per event (last 2000 lines). Filter by text,
by session (when several are live), and by group chips: one per event-type
prefix (`task`, `island`, `memory`, …) plus one per `log` level. Click a
chip to toggle it, shift- or alt-click to solo it. **pause** holds incoming
lines until resume; click a line to expand its full payload. Timestamps are
the dashboard's wall clock at receipt, with the event's per-thread elapsed
time alongside.

`log` lines are SDK log entries (`src/log.ts`) mirrored into the stream:
they follow the emitting thread's `setLogLevel` (default `info`), carry a
preview of the entry's data, and include worker logs once that worker's
devtools forwarding is on. A worker's logs from before its INIT handshake,
or from a worker spawned before devtools was enabled, never arrive.

## Live controls

The dashboard sends commands to a live app over the same transport
(`control` frames; see [docs/devtools.md](https://github.com/jwhenry3/atolljs/blob/main/docs/devtools.md)).
A control is enabled only when the session is live, not a replayed
recording, and the app advertises the command; otherwise its tooltip says
why.

- **Kill worker** (worker inspector): `worker.kill` runs the runner's real
  crash path with the message `killed from devtools`: in-flight calls reject
  with `WorkerCrashedError` and the worker respawns when the runner allows
  it. Asks for confirmation first.
- **Chaos** (worker inspector, applies to the whole runner): `pool.chaos`
  with a delay before each call is posted (ms), a fail rate (calls rejected
  with `chaos: injected failure`, settle outcome `error`, never reaching the
  worker), and a timeout rate (calls failed through the real timeout path,
  outcome `timeout`; the call still runs and its late reply is discarded).
  Rates are percentages in the form; fail + timeout can't exceed 100%.
  **Clear** removes it. The palette's "Chaos: clear all" clears every runner
  in every live session.
- **Edit props** (island inspector): loads the island's current props as
  JSON (`island.props`), and **Apply** (Ctrl+Enter) sends
  `island.updateProps`. Callbacks show as `"[fn]"`; leaving a placeholder in
  place keeps the original callback wired.
- **Push / Poll** (island inspector): `island.setMode` switches the
  island's transport mode.

Pools and islands created inside a worker (sub-pools, nested islands) are
not controllable: their handles live in that worker, which has no
transport. A nested island's DOM still shows up in its top-level island's
Elements tree.

## Shared-memory watchpoints

In **Memory › Values**, pick a field and a rule, then **Add watch**. Rules:
`change`, `> n`, `< n`, `>= n`, `<= n`, `== v`, `!= v`, where `v` is JSON
when it parses (`== "down"`, `== true`, `== 3`) and a bare string otherwise.
Numeric comparisons only match number/bigint fields; list fields support
`change` only. Each match emits a `memory:watch-hit` event (path, version,
value preview, rule), listed in the watch-hit log with per-watch hit
counts. Setting a watch takes the current value as the baseline (not a
hit). Writes on the main thread are checked synchronously; writes from
workers are checked when the main thread observes the version bump, so a
burst between two observations coalesces to the latest value.

## Jank probe and User Timing

`connectDevtools({ jank })` (default on) installs a browser main-thread
probe:

- `runtime:longframe`: Long Animation Frame entries where supported
  (`blockingMs` plus the five longest scripts), `longtask` entries
  otherwise. Frames that report no blocking and under 50ms of script time
  are skipped as throttled renders. While the page is hidden, frame length
  is throttling rather than work, so only frames with at least 100ms of
  script (or a `longtask` of 100ms or more) are reported, flagged
  `hidden: true`. Performance draws them gray and counts them as
  "background work"; they stay out of the foreground jank KPIs, and Audits
  reports them under `background-work` instead of `main-jank`.
- `runtime:frames`: a requestAnimationFrame sampler, one event per second
  with fps and the frames that took over about twice the display interval.
  A gap over a second (hidden tab, debugger pause) restarts the window.

The flyout dashboard is a same-origin iframe sharing the app's main thread,
so its own rendering counts as app jank. Use the full-page dashboard (its
own tab) when measuring.

While devtools is enabled the SDK also writes User Timing measures, so the
browser's Performance panel shows atoll work next to the app's frames. In
Chrome they land in an `atoll` track group:

| Measure | Where | Track |
|---|---|---|
| `atoll task <taskId>` | main thread, dispatch to reply | the runner id (`pool-1`, `search-w`) |
| `atoll run <taskId>` | inside the worker, task execution | `tasks` |
| `atoll replay <instance>` | main thread, one island op-batch replay | `islands` |

Each measure is cleared from the timeline buffer right after it is
recorded (the Performance panel has already captured it), so
`performance.getEntriesByType('measure')` won't accumulate them.

## Message cost

`task:dispatch.argBytes`, `task:settle.resultBytes`, and `island:ops.bytes`
are estimates from `estimateCloneBytes` (strings 2 bytes per char, numbers 8,
typed arrays and buffers by `byteLength`, plus small per-key overhead; the
walk stops after 5000 nodes), a "is this message big?" signal, not an exact
count. `resultBytes` is set only on `ok` settles; errored, timed-out,
aborted, and crashed calls carry none.

## Recording and replay

Every batch the dashboard receives lands in a rolling capture (the last
~50,000 events). The toolbar adds:

- **● Rec / ■ Stop**: an explicit recording (stops itself at 500,000
  events).
- **Export**: downloads the recording when there is one, else the rolling
  capture, as `atoll-devtools-<session-or-all>-<yyyymmdd-hhmmss>.json`.
  With a session selected, only that session is exported.
- **Import**: opens a recording (or drop the file on the window). Replay
  pauses the live transport, resets the dashboard, and re-ingests the file
  through the normal ingest path, so every view rebuilds as it did live. A
  banner offers Play/Pause, speed (1x, 4x, 16x, max), a scrubber (seeking
  rebuilds up to that point), and **Back to live**. Replayed sessions are
  named with a `⏺ ` prefix and are closed, so no control command can fire.

The file format is `{ format: 'atoll-devtools-recording', version: 1,
exportedAt, sessions, frames: [{ t, sessionId, events }] }`, with `t` the
dashboard's receive clock (replay only uses differences).

## Keyboard, palette, deep links

| Key | Action |
|---|---|
| Ctrl+K / ⌘K | Command palette: views, subviews, islands, workers, pools, sessions, commands |
| `g` then a letter | Go to a view: `d` Dashboard, `t` Tasks, `p` Performance, `n` Network, `m` Memory, `r` Reactivity, `a` Audits, `l` Log |
| `[` / `]` | Previous / next sub-tab |
| `/` | Focus the current view's search or filter box |
| `s` | Show / hide the sessions sidebar (full page, aggregate mode) |
| `?` | Shortcuts and what each view is for |
| Esc | Close the palette, help, or a menu |
| Alt+Shift+D | Show / hide the flyout, from the app page or inside the flyout |

The address hash tracks where you are:
`#/<view>[/<sub>][?session=…&island=…&worker=…]`. Share it, reload it, or
use Back / Forward on the full page; a routed island or worker opens once it
appears (matching by key in a reloaded session too). Inside the flyout the
hash is updated with `replaceState` only, so devtools navigation never adds
entries to the host page's history. The last view is remembered per layout
(flyout and full page). The flyout's **full page ↗** link opens the same
route; the palette's "Copy link to this view" copies it. A first-run tip
points at the palette.

## Chrome DevTools extension

The same dashboard also runs as an **atoll** panel inside Chrome DevTools,
for the inspected tab, with no flyout and no second tab:

```bash
npm run build:extension   # → packages/devtools-extension/dist
```

Open chrome://extensions, enable Developer mode, choose "Load unpacked" and
pick `packages/devtools-extension/dist`. The app still needs devtools on
(`initDevtools()` with `?__atoll_devtools`, or `connectDevtools()`). Frames
are pushed, not polled: a content script that stays passive until the panel
attaches joins the page's `atoll-devtools` channel and relays through the
extension's service worker. Because that script is declared for all URLs,
Chrome warns "Read and change all your data on all websites" at install;
tabs opened before install need a reload. Details and limitations are in
[packages/devtools-extension/README.md](https://github.com/jwhenry3/atolljs/blob/main/packages/devtools-extension/README.md).

## OpenTelemetry export

```ts
import { exportOtel } from '@atolljs/devtools/otel';

// Before any pool spawns, like every devtools sink.
const otel = exportOtel({ endpoint: 'http://localhost:4318', serviceName: 'my-app' });
// ...
await otel.close(); // flushes; never rejects
```

Task calls, island round trips and fetches become spans; pool, runtime and
shared-memory activity become cumulative metrics; `log` events and worker
crashes become log records. It runs alongside `connectDevtools()` or on its
own. To forward everything the aggregate server receives instead:

```bash
npx atoll-devtools --otlp http://localhost:4318 --otlp-headers x-api-key=abc --otlp-service atoll
```

Mapping, clock handling and retry behavior are in
[docs/devtools.md](https://github.com/jwhenry3/atolljs/blob/main/docs/devtools.md#opentelemetry-export-atolljsdevtoolsotel).

## How events get there

- Worker-side events reach the sink automatically: pools pass a
  `devtools` flag in INIT, workers forward `ATOLL_DEVTOOLS` messages back
  over the task channel, and the pool stamps each with
  `worker: {poolId, slot}`, so `memory:write`, `net:fetch`, worker heap
  samples, and worker logs attribute to a specific worker. Only active when
  a sink was installed before the spawn.
- `net:fetch` covers `fetch()` on the main thread (via the probe
  `connectDevtools` installs) and inside workers (probed when forwarding
  is enabled). XHR is not covered.
- `runtime:memory` uses Chrome's `performance.measureUserAgentSpecificMemory`
  on the main thread (cluster breakdown: every worker context listed by
  its script URL), `performance.memory` where available, and
  `process.memoryUsage()` on Node (heapUsed + RSS, also inside
  `worker_threads`, so per-worker heap columns populate for Node pools).
- Commands register lazily, only while devtools is enabled: `pool.*` and
  `worker.kill` with the first runner, `island.*` with the first mounted
  island, `memory.*` with the first contract bind, `reactive.nodes` with the
  first reactive node.
- Zero cost when unused: `emitDevtools` is one branch without a sink, and
  `connectDevtools()` is the only thing that installs one.
- Events buffered while the socket connects are capped (50k, oldest
  dropped); batches flush every 100ms.

## Wire protocol

JSON text frames. Apps → server on `/events`: `{type:'hello', session}`
then `{type:'batch', events[]}`. Dashboards → server on `/view`:
`{type:'sessions'}` then `{type:'batch', session, events}` fan-out, with a
bounded tail replayed to late joiners. Commands travel as
`{type:'control', sessionId, id, cmd, args}` and come back as
`{type:'control-result', sessionId, id, ok, result | error}`. See
`src/protocol.ts`.
