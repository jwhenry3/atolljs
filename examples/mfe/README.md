# mfe/ — the shared micro-frontends

This folder models five independently "published" micro-frontends — one per
supported framework — consumed by every `examples/<fw>-host/` shell. There is
no package.json here on purpose: each MFE is just two files a bundler can
resolve, which is all the islands architecture asks of a remote:

```
contracts/<name>.contract.ts   framework-free { app, props, events, worker }
worker/<name>.worker.ts(x)     the worker entry — owns its framework runtime
```

## The contract module is the boundary

```ts
import { z } from '@atolljs/core';
import { defineIslandContract } from '@atolljs/islands';

export const counterContract = defineIslandContract({
  app: 'counter',
  props: z.object({ label: z.string().optional() }),
  events: { incremented: z.object({ count: z.number(), label: z.string() }) },
  worker: () =>
    new Worker(new URL('../worker/counter.worker.tsx', import.meta.url), { type: 'module' }),
});
```

- **Shell side** imports only the contract: props and `onEvent` payloads
  infer from the `z` schemas, and the `worker` factory makes the contract a
  self-contained mount point (`islandComponent(contract)`, `lazyIsland(() =>
  import('./x.contract'))`, `use:island={{ app: contract, … }}`,
  `islandComponent({ contract })` — pick the facade for your shell).
- **Worker side** imports the same module and attaches it to the app
  (`define*MonoWorker(Component, { contract })`): props parse at mount and
  `updateProps`, declared event payloads parse at `emit`. Version skew
  between shell and worker fails loudly instead of silently dropping fields.
- **Neither side imports the other.** The React shell never bundles Angular;
  the Angular worker never bundles React.

## The five MFEs

| contract | implementation | props | events |
| --- | --- | --- | --- |
| `counter` | React (`counter.worker.tsx`) | `label?` | `incremented {count,label}` |
| `notes` | Vue SFC (`notes.worker.ts`) | `title?` | `noteAdded {text,total}` |
| `ticker` | Solid (`ticker.worker.ts`) | `label?`, `intervalMs?` | `tick {count}` |
| `dial` | Svelte (`dial.worker.ts`) | `label?`, `value?` | `changed {value}` |
| `checkout` | Angular (`checkout.worker.ts`) | `label?`, `total` | `paid {total}` |

Each uses `define<Fw>MonoWorker` — one worker per MFE, so every island's
bundle carries only its own framework and failure domain.

## Hosts

`examples/react-host`, `examples/vue-host`, `examples/solid-host`,
`examples/svelte-host`, `examples/angular-host` mount all five — including
their own framework's MFE through the same contract path, so the contract
layer is the uniform boundary, not a special case.
