# @atolljs/federation

Controlled module federation for Atoll worker islands: a host worker that
imports remote **app modules** into one realm — shared dependencies dedupe
by module identity, remote `requires` ranges negotiate against a
host-published shared scope, and mounts stay ordinary `mountIsland` calls.

For remote *worker bundles* (each MFE its own realm/thread), see
`docs/islands-remote.md`. Federation is the sharing-maximizing
alternative; see `docs/federation.md` for the full contract.

## Host

```ts
// federation.worker.ts
import { defineFederationHost } from '@atolljs/federation/worker';
import * as React from 'react';

export const host = defineFederationHost({
  remotes: {
    checkout: 'https://mfe.example.com/checkout.app.js',
    notes: { manifest: 'https://mfe.example.com/mfe.manifest.json' },
  },
  shared: { react: { module: React, version: '18.3.1' } },
});
```

```ts
// shell
import { connectFederation } from '@atolljs/federation';
import { mountIsland } from '@atolljs/islands';

const fed = connectFederation({
  worker: () => new Worker(new URL('./federation.worker.ts', import.meta.url), { type: 'module' }),
});
await mountIsland({ client: fed, el, app: 'checkout', props });
```

## Remote

```ts
// checkout.app.ts — published as an app module (no worker runtime)
import { defineRemoteApp, useShared } from '@atolljs/federation';
import { withContract } from '@atolljs/islands';
import { reactIslandApp } from '@atolljs/react-island/worker';

export const requires = { react: '^18' };
export const exposes = {
  checkout: defineRemoteApp(withContract(checkoutContract, reactIslandApp(Checkout))),
};
```

## Publish build

```ts
// vite.mfe.config.ts
import { atollFederation } from '@atolljs/federation/vite';

atollFederation({
  name: 'checkout-mfe',
  exposes: { checkout: 'src/mfe/checkout.app.ts' },
  shared: { react: 'https://shell.example/@atoll-shared/react@18.3.1.js' },
  manifest: { requires: { react: '^18' } },
});
```

## Exports

| Specifier | Contents |
|---|---|
| `@atolljs/federation` | `connectFederation`, shared scope (`provideShared`/`useShared`/`sharedDeps`/`satisfiesVersion`), remote metadata (`defineRemoteApp`/`remoteAppMetaOf`/`resolveRemoteModule`), manifests (`parseRemoteManifest`/`fetchRemoteManifest`, `RemoteManifest`) |
| `@atolljs/federation/worker` | `defineFederationHost` + the shared scope and remote stamps (worker-entry surface) |
| `@atolljs/federation/vite` | `atollFederation` publish-build plugin |
