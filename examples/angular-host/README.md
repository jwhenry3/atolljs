# angular-host — an Angular shell hosting five worker-rendered micro-frontends

One Angular app mounts islands rendered by **React, Vue, Solid, Svelte, and
Angular** — each in its own `defineMonoWorker` worker, each reached only
through its framework-free contract module in [`../mfe/`](../mfe/README.md).

```ts
import { islandComponent } from '@atolljs/angular-island';
import checkoutContract from '../../mfe/contracts/checkout.contract';

const CheckoutIsland = islandComponent({ contract: checkoutContract, selector: 'checkout-island' });
// <checkout-island [props]="{ label: 'cart', total: 42 }" [onEvent]="onPaid" />
```

`islandComponent({ contract })` generates a standalone component whose
`[props]` input types off the contract's prop schema and `[onEvent]` narrows
to its declared events — typed end-to-end without importing the worker
component class or its framework. The contract's `worker` field supplies
the connection.

## Run

```bash
npm install
npm run dev    # http://localhost:5184
npm run build  # tsc --noEmit + vite build
```

Sibling hosts: `../react-host`, `../vue-host`, `../solid-host`,
`../svelte-host` — same five MFEs, different shell.
