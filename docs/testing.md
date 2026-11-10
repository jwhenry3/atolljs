# Testing: `InProcessWorker` and browser-less island tests

Read when: writing vitest coverage for workers, pools, islands, or
federation hosts — anything that would normally need a real `Worker`.

`src/testing/inProcessWorker.ts` is a `Worker` test double that runs the
**real** protocol in-process: `INIT_MEMORY` binds every defined
shared-memory contract to the pool's buffer, `EXECUTE_TASK` dispatches
through the real `TaskRegistry`. Everything except the OS thread boundary
is real — same registry, same contract wiring, same task semantics.

## Setup

```ts
// @vitest-environment happy-dom   ← real Document for the mount driver
import { vi } from 'vitest';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [() => import('./fixtures/my.worker')];
```

Two pieces:

- `vi.stubGlobal('Worker', InProcessWorker)` — every `new Worker(url)`
  becomes an in-process double. The `url` is still captured (assert on it
  via `InProcessWorker.created[i].url`), it just isn't fetched.
- `InProcessWorker.handlerModules` — importers that run at boot, standing
  in for the worker entry's module evaluation (the `define*Worker` side
  effects are what register tasks/apps). Point it at the fixture worker
  entry your test exercises; the same array boots every spawned worker.

`happy-dom` supplies `document`/`Element` for `mountIsland`'s real-DOM
replay; worker-side code uses the proxy DOM as always.

## Semantics worth knowing

| Member | Behavior |
|---|---|
| `created` | Every spawned instance — inspect `url`, call `.crash()` to simulate a worker error event |
| `terminated` / `executed` | `terminate()` flag; raw `EXECUTE_TASK` messages the worker received |
| Boot failure | A handler module that throws fires a real `'error'` event and marks the worker dead: the pool's error path rejects in-flight calls (same as a real failed entry) and the dead worker silently drops later tasks |
| `crash(message)` | Manual error-event injection for respawn/keepalive tests |

`SharedArrayBuffer` exists under Node, so doorbell/push mode works
in-process; pass `doorbell: false`/`mode: 'poll'` only when the *behavior
under test* is the poll path.

## The shared module graph caveat

In-process means ONE module graph: every fixture's `definePolyWorker`
registers into the same module-level `APP_REGISTRY` (documented in
`worker/defineWorkers.ts` — the union is deliberate, mount resolution is
identical). Two consequences:

- Keep app keys distinct across fixtures in a suite — a second fixture
  registering `'counter'` overwrites the first.
- Tests can't prove thread isolation (they prove protocol and semantics).
  For real-thread behavior there's no shortcut: build and drive a browser.

## Patterns in the suite

**Task-level** — talk to the client directly, assert on op batches
(`packages/islands/test/islandContract.test.ts`):

```ts
const client = connectIslandWorker({ worker: contractWorker });
const ops = await client.mount('checkout@1', { count: 2 });
expect(ops.some((o) => o.t === 'create')).toBe(true);
await expect(client.mount('checkout@1', { count: 'x' })).rejects.toThrow(/contract/);
```

Event round-trips dispatch by handler id — find the `listen` op in the
mount batch, pass its `handler` to `client.dispatch`:

```ts
const handler = ops.find((o) => o.t === 'listen')!.handler;
const after = await client.dispatch(handler, { type: 'click' });
expect(after).toContainEqual({ t: 'emit', name: 'paid', payload: { total: 20 } });
```

**Driver-level** — `mountIsland` end-to-end into a happy-dom element,
asserting real DOM after replay (`packages/islands/test/islandDriver.test.ts`).

**Federation** — the host's remote *importers* (`() => import('./x.app')`)
resolve through the same module graph, which is exactly the `loadApp`
seam: `packages/federation/test/federation.test.ts` exercises lazy remote
mounts, shared-scope reads, and requires negotiation with no URL involved.

**Devtools events** — `emitDevtools` sinks are stubbed the same way
(`packages/islands/test/islandDevtools.test.ts`).

## Conventions

- Fixture workers live in `test/fixtures/`; the test file stubs `Worker`,
  registers the fixture, then dynamic-`import()`s the package surface in
  `beforeAll` so the stub lands first.
- Every spawned client needs `client.terminate()` — the pool isn't real,
  but handles and timers are.
- `// @vitest-environment happy-dom` per file; node-only suites (pools,
  memory) don't need it.
