# Federation — shared dependencies across micro-frontends

Read when: working on `packages/federation/`, `defineFederationHost`, remote
app modules, or the shared-dependency scope. For remote *worker bundles*
(each MFE its own realm), see [islands-remote.md](islands-remote.md) —
federation is the alternative topology: remote *modules* inside ONE realm.
Step-by-step setup: [federation-getting-started.md](federation-getting-started.md).

`@atolljs/federation` is module federation under atoll's control: a host
worker imports remote app modules on first mount, so every mounted MFE
shares one module graph, one framework copy, and one shared-dependency
scope — dedupe enforced by the realm, not by convention.

## Why a second remote topology

[islands-remote.md](islands-remote.md) publishes self-contained *worker
bundles*: each MFE is its own OS thread with its own copies of everything —
maximum isolation, zero sharing. Federation inverts that on purpose: the
remote publishes an *app module* (no worker runtime, no worker bootstrap)
and atoll's host worker `import()`s it into its own realm. What that buys:

- **Shared singletons, actually shared.** A `react` copy, a design system,
  a store: one instance in the realm, reachable by every remote that
  resolves the same specifier — the thing module federation's `shared`
  config approximates, here guaranteed by ESM itself (same specifier in
  one realm = same module instance).
- **Version negotiation.** Remote modules declare `requires` ranges; the
  host checks them against its shared scope before registration. A
  mismatch rejects the mount with a named error — same philosophy as
  contract prop validation.
- **One failure domain, knowingly.** Everything in a host worker stalls or
  dies together. That's the documented `client:` trade-off
  ([islands.md](islands.md#definitions-workers-instances)) stretched across
  team boundaries — keep isolation-critical MFEs on remote worker bundles.

## The pieces

| Piece | Side | What it is |
|---|---|---|
| `defineFederationHost({ remotes, apps?, shared? })` | worker entry | A PolyWorker whose registry is dynamic — `mount` on an unregistered key runs the remote loader |
| `connectFederation(config)` | shell | `connectIslandWorker` over the host entry; mounts are ordinary `mountIsland({ client, app })` |
| Remote module | published MFE | An ES module exporting `exposes`/`default`/named island apps + `requires` — built WITHOUT a worker runtime |
| `provideShared` / `useShared` | worker realm | The shared-dependency scope (`globalThis.__atollShared`) |
| `RemoteManifest` / `{ manifest }` refs | shell ops | JSON mapping app keys → module URLs; fetched lazily, cached per URL |
| `atollFederation` | publish build | Vite plugin: `shared` → rollup `external` + `output.paths` URL rewrite, emits `mfe.manifest.json` |

## Host side

```ts
// federation.worker.ts — shell-owned worker entry
import { defineFederationHost } from '@atolljs/federation/worker';
import * as React from 'react';

export const host = defineFederationHost({
  remotes: {
    checkout: 'https://mfe.example.com/checkout.app.js',          // module URL
    notes: { manifest: 'https://mfe.example.com/mfe.manifest.json' },
    dial: () => import('./dial.app'),                             // same-repo through the seam
  },
  apps: { status: statusApp },   // local apps mix into the same registry
  shared: {
    react: { module: React, version: '18.3.1' },
  },
});
```

```ts
// shell — identical to a shared-client mount
const fed = connectFederation({
  worker: () => new Worker(new URL('./federation.worker.ts', import.meta.url), { type: 'module' }),
});
await mountIsland({ client: fed, el, app: 'checkout', props }); // first mount imports the remote
```

`remotes` values (`RemoteRef`): a module specifier string, `{ url, requires? }`,
`{ manifest: url | RemoteManifest }` (the app key indexes `manifest.apps`,
relative specifiers resolve against the manifest URL), or an importer
function. Resolution is per-mount and once: a loaded app registers under
its key, so later mounts are registry hits.

The `loadApp` seam this rides on (`PolyWorkerRegistry.loadApp`) disables
the name-blind single-app fallback: a host with one local app still
rejects `mount('typo')` instead of silently serving that app.

## Remote side

```ts
// checkout.app.ts — the published entry (bundled as an app chunk, not a worker)
import { defineRemoteApp } from '@atolljs/federation';
import { withContract } from '@atolljs/islands';
import { reactIslandApp } from '@atolljs/react-island/worker';

export const requires = { react: '^18' };
export const exposes = {
  checkout: defineRemoteApp(withContract(checkoutContract, reactIslandApp(Checkout))),
};
```

The host picks the app by `exposes[name]`, then `default`, then a `name`
export. `requires` merges module-level and `defineRemoteApp`-stamped
ranges; every range must satisfy the scope's provided version or the mount
rejects. Remote code reads shared deps with `useShared(name, range?)` —
throwing at call time when unprovided, so misconfigured hosts fail at
load, not mid-render.

Contracts are unchanged: stamp with `withContract` and mount/updateProps/
emit validation runs inside the worker exactly as for local apps.

## Sharing code without the scope: pinned URLs

`useShared` is the runtime path. For import-syntax deps (frameworks you
can't call a function to get), the realm dedupes on identical specifiers:
`atollFederation({ shared: { react: 'https://shell/@shared/react@18.js' } })`
externalizes `react` and rewrites its specifier to that URL. Apply the
same `shared` map to the host's own build (a checked-in JSON both configs
read is the "lockfile"), and both bundles import one URL — one instance.

## Failure modes

| Symptom | Cause |
|---|---|
| `mount` rejects "unknown app" | App key not in `apps`/`remotes`, or the loader returned undefined |
| Mount rejects "exposes no island app" | Remote module loaded but lacks `exposes[name]`/`default`/named app — wrong URL or old remote |
| Mount rejects `requires shared dep "x@range"` | Host `shared` doesn't provide it, or version outside the remote's range — the negotiated mismatch |
| Mount rejects "no 'x' app — manifest exposes" | Manifest's `apps` map lacks the key — remote deploy drift |
| `useShared` throws "not provided" | Remote called it for a dep the host never published |
| All islands on a client die together | Shared-realm trade-off — move that MFE to a remote worker bundle |

Every failure in the table is a mount rejection or a runtime crash — both
are boundary-covered: `mountIsland({ boundary })` renders the error state
(remote URL, requires mismatch, or crash named in `ctx.error`) and
`retry()` re-runs `loadApp` in the respawned realm. See
[error-boundaries.md](error-boundaries.md).
