# Federation: getting started

A complete walkthrough: host worker, shell mounts, a local remote, then a
real published remote with a manifest and shared dependencies. Reference
material lives in [federation.md](federation.md); this doc is the
step-by-step.

The cast: a **shell** (your page), a **host worker** (one worker whose
registry grows as remotes load), and **remotes** (published app modules —
no worker runtime). Every island mounted on the federation client lands in
that one realm: shared dependencies are the same module instances for
everybody.

## 1. The host worker entry

One entry file, owned by the shell app:

```ts
// src/federation.worker.ts
import { defineFederationHost } from '@atolljs/federation/worker';

export const host = defineFederationHost({
  remotes: {
    // Same-repo remote — an importer through the same seam (dev mode,
    // monorepo, or "MFE that ships with the shell").
    counter: () => import('./remotes/counter.app'),
  },
  apps: {
    // Local apps mix into the same registry — nothing about them is special.
    status: {
      imperative: (doc) => {
        const el = doc.createElement('div');
        el.textContent = 'host up';
        doc.body.append(el);
      },
    },
  },
});
```

Nothing is imported or fetched until a mount names the key — `remotes` is
a lazy menu, not a preload list.

## 2. The shell

`connectFederation` is `connectIslandWorker` under a name that reads as the
topology; mounts are ordinary `mountIsland` calls:

```ts
// src/main.ts
import { connectFederation } from '@atolljs/federation';
import { mountIsland } from '@atolljs/islands';

const fed = connectFederation({
  worker: () =>
    new Worker(new URL('./federation.worker.ts', import.meta.url), { type: 'module' }),
});

const island = await mountIsland({
  client: fed,
  el: document.getElementById('counter')!,
  app: 'counter',          // first mount: imports ./remotes/counter.app inside the worker
  props: { label: 'Clicks' },
});
```

`app` may also be an `IslandContract` — the contract layer is unchanged.
A second `mountIsland({ client: fed, app: 'counter' })` is a registry hit:
the remote module imported once.

## 3. A remote app module

A remote is a plain module exporting island apps — the same registry
values (`{ imperative }` or a framework adapter's `RenderedIslandApp`)
you'd pass to `definePolyWorker`, plus the federation metadata:

```ts
// src/remotes/counter.app.ts
import { z } from '@atolljs/core';
import { defineRemoteApp, useShared } from '@atolljs/federation';
import { defineIslandContract, emit, withContract } from '@atolljs/islands';

export const counterContract = defineIslandContract({
  app: 'counter',
  props: z.object({ label: z.optional(z.string()) }),
  events: { incremented: z.object({ count: z.number() }) },
});

// What this module needs from the host's shared scope — checked BEFORE
// registration, so an unsatisfiable host fails the mount, not the render.
export const requires = { 'design-tokens': '^1' };

export const exposes = {
  counter: defineRemoteApp(
    withContract(counterContract, {
      imperative: (doc, props) => {
        const tokens = useShared<{ accent: string }>('design-tokens');
        const btn = doc.createElement('button');
        btn.style.color = tokens.accent;
        let count = 0;
        const render = (): void => {
          btn.textContent = `${String(props.label ?? 'counter')}: ${count}`;
        };
        btn.addEventListener('click', () => {
          count += 1;
          render();
          emit('incremented', { count });
        });
        render();
        doc.body.append(btn);
      },
    }),
  ),
};
```

Exposure resolution is `exposes[name]` → `default` → a `name` export —
`exposes` is the shape to standardize on (multi-app remotes map several
keys through one module).

## 4. Shared dependencies

`useShared(name, range?)` is the runtime path: the remote asks the realm
for the object instead of bundling it. The host publishes the scope before
any remote loads:

```ts
// federation.worker.ts
shared: {
  'design-tokens': { module: { accent: 'rebeccapurple' }, version: '1.4.0' },
  react: { module: React, version: '18.3.1' },
},
```

- `useShared('design-tokens')` inside the remote returns THAT object —
  one instance for every remote, mutable in one place.
- `requires = { 'design-tokens': '^1' }` negotiates at mount: absent or
  `v2.x` → the mount rejects with a named error (`remote app "counter"
  requires "design-tokens@^1" — host provides v…`).
- Bare `shared: { x: someObject }` publishes at version `'0'` — unversioned
  (only `'*'` ranges accept it).

For `import`-syntax deps (a framework's own imports, JSX runtime), the
realm dedupes on identical specifiers — see step 6's `shared` URL pinning.

## 5. Publishing: the remote's build

The remote ships an **app chunk + manifest**, not a worker bundle. Its
publish build uses the `atollFederation` Vite plugin:

```ts
// vite.mfe.config.ts (in the remote's repo)
import { defineConfig } from 'vite';
import { atollFederation } from '@atolljs/federation/vite';

export default defineConfig({
  plugins: [
    atollFederation({
      name: 'counter-mfe',
      exposes: { counter: 'src/counter.app.ts' },
      // Dep specifier → the URL BOTH builds agree on. The emitted chunk
      // keeps `import ... from 'https://shell/@atoll-shared/react@18.3.1.js'`
      // verbatim — inside the host realm that's the same specifier the
      // host bundle resolved to, so ESM dedupes the instance.
      shared: { react: 'https://shell.example/@atoll-shared/react@18.3.1.js' },
      manifest: { version: '1.0.0', requires: { react: '^18' } },
    }),
  ],
  define: { 'process.env.NODE_ENV': '"production"' }, // lib mode: see islands-remote.md
  build: {
    outDir: 'dist-mfe',
    lib: { entry: 'src/counter.app.ts', formats: ['es'], fileName: () => 'counter.app.js' },
  },
});
```

Output: `counter.app.js` + `mfe.manifest.json`:

```json
{
  "name": "counter-mfe",
  "version": "1.0.0",
  "apps": { "counter": "./counter.app.js" },
  "requires": { "react": "^18" }
}
```

The "controlled environment" is the `shared` URL map: check it in as JSON
both the host's build and every remote's build read — that's your
federation lockfile. A remote built with a different URL gets its own copy
(the realm can't merge them); a remote built with a different *major* gets
caught by `requires`.

## 6. Consuming the deployed remote

Serve `dist-mfe/` with `Access-Control-Allow-Origin` (same requirement as
[islands-remote.md](islands-remote.md#serving-requirements-remote-side) —
the host worker's `import()` and the manifest `fetch` are CORS fetches).
Then point the app key at the manifest:

```ts
remotes: {
  counter: { manifest: 'https://mfe.example.com/mfe.manifest.json' },
},
```

The manifest fetches once (cached per URL), `apps.counter` resolves
relative to the manifest URL, and the module imports inside the worker.
`manifest.requires` merges with the module's own `requires` — deploy-level
and code-level declarations both negotiate.

Direct URL refs work too (`{ url: '…/counter.app.js' }`, or a bare
string) — manifests exist for hashed filenames and multi-app remotes, not
as a requirement.

## 7. Operate

- **Headers**: the host worker is an ordinary island worker — COOP/COEP
  for the doorbell, or `connectFederation({ doorbell: false })` on
  non-isolated pages.
- **Timeouts**: a remote URL that never answers fails the mount through
  the usual `mountTimeout` — name the URL in `remotes` keys sensibly, it
  shows in errors.
- **Warm starts**: `connectFederation({ keepAlive: true })` keeps the
  realm (and its loaded remotes + scope) resident between mounts.
- **Failure domain**: everything on the client shares it. An MFE that
  must fail alone stays on a remote worker bundle
  ([islands-remote.md](islands-remote.md)) — the contract API is the same,
  so the shell code doesn't change.

## Failure modes quick reference

| Symptom | Cause |
|---|---|
| `mount` rejects "unknown app" | Key absent from `apps` and `remotes` |
| "exposes no island app" | Module loaded but no `exposes[name]`/`default`/named export |
| `requires shared dep "x@range"` | Host doesn't provide it, or version mismatch |
| Manifest `fetch` fails | Missing CORS on the remote origin |
| "no 'counter' app — manifest exposes" | Manifest `apps` lacks the key |

Full table: [federation.md](federation.md#failure-modes).
