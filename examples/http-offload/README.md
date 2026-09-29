# http-offload — HTTP served inside worker threads, two ways

> The gateway (:3204) runs on **any** Node version. The clustered listener
> (:3205) requires **Node.js ≥ 26** — `net.Socket` transfer across
> `worker_threads` landed in v26.

Two topologies over the same two-worker pool:

## :3204 — gateway (any Node)

Path-level ownership — some routes in worker A, some in worker B, some on
the main thread. The main thread parses HTTP once and proxies matched
prefixes to workers' internal `127.0.0.1` listeners (`serveHttp({listen})`
announces each port to the parent).

| Route prefix | Owner |
|---|---|
| `/api/a/*` | pool worker 0 ("worker A") |
| `/api/b/*` | pool worker 1 ("worker B") |
| everything else | the main thread itself |

`/api/a/incidents/query` reaches the worker as `/api/incidents/query` — the
prefix only names the owner. `worker`/`x-worker` in every response shows
which thread actually served it.

## :3205 — clustering (Node ≥ 26)

The `cluster` module's accept-and-handoff on `worker_threads` — the inverse
of task dispatch: the main thread accepts TCP connections with
`pauseOnConnect` and transfers each `net.Socket` to a pool worker — it never
reads request bytes. Each worker's `http.Server` + Express owns parsing,
routing, and serialization entirely off-thread.

## Layout

- `src/main.ts` — `createNodePool(poolSize: 2)` + `routeHttpGateway` on :3204
  + `createHttpCluster` on :3205 (Node ≥ 26). The API thread also
  dispatches the boot-time `seedIncidents` task — the same workers serve
  HTTP and tasks.
- `src/offload.worker.ts` — worker entry: `@atolljs/node/shim`, the incidents
  task registrations, then `serveHttp(createApp(), { listen: 0 })`.
- `src/app.ts` — Express app factory; runs once per worker. Every response is
  tagged with `worker: <threadId>` and an `x-worker` header so routing is
  observable.

## Endpoints (gateway :3204)

| Endpoint | Runs on |
|---|---|
| `GET /api/whoami` | **main thread** (`worker: 0`) |
| `GET /api/a/whoami` | worker A · `GET /api/b/whoami` → worker B |
| `POST /api/incidents/seed` | main route → **task dispatch** into the pool |
| `POST /api/a/incidents/seed` | worker A — direct `seedIncidents.run()` |
| `GET /api/incidents/seed-progress` | main — direct shared-memory read |
| `GET /api/b/incidents/stats` | worker B — `computeMetrics.run()` |
| `GET /api/a/incidents/query?severity=critical` | worker A — `queryIncidents.run()` |
| `GET /api/incidents/:id` | main — direct record read |

## Run

```bash
npm install
npm run dev       # bundles dist/offload.worker.js, then tsx src/main.ts
```

Then:

```bash
curl http://localhost:3204/api/whoami        # {"worker":0} — main thread
curl http://localhost:3204/api/a/whoami      # {"worker":N} — always worker A
curl http://localhost:3204/api/b/whoami      # {"worker":M} — always worker B
curl http://localhost:3205/api/whoami        # Node ≥ 26 — any worker (round-robin)
```

The worker entry is bundled with esbuild because `worker_threads` spawn
plain Node processes — tsx hooks/tsconfig `paths` don't propagate into
workers. After editing worker-side code, restart `npm run dev` to rebuild.

## Design notes

- The gateway reads `pool.workers` fresh per request and re-tracks announced
  ports, so a respawned worker takes over its prefixes automatically.
- `serveHttp` accepts any `(req, res)` listener — Express, Koa `.callback()`,
  or an `http.Server` like `fastify().server`.
- Worker listeners bind `127.0.0.1` only — the gateway owns the public port.
- Socket transfer can't split a listener by URL path (the accept thread
  never reads bytes) — that's exactly what the gateway is for.
- Plain HTTP only for the transfer path: a TLS handshake would run on the
  accepting thread. Terminate TLS upstream or serve plain HTTP behind a
  proxy.
