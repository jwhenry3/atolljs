# react-host — a React shell hosting five worker-rendered micro-frontends

One React app mounts islands rendered by **React, Vue, Solid, Svelte, and
Angular** — each in its own `defineMonoWorker` worker, each reached only
through its framework-free contract module in [`../mfe/`](../mfe/README.md).

```tsx
import { islandComponent } from '@atolljs/react-island';
import checkoutContract from '../../mfe/contracts/checkout.contract';

const CheckoutIsland = islandComponent(checkoutContract); // Angular in the worker
<CheckoutIsland label="cart" total={42} onEvent={(name, p) => …} />
```

`CheckoutIsland`'s props are `{ label?: string; total: number }` and
`onEvent` narrows to `'paid' → { total: number }` — both inferred from the
contract's `z` schemas. The contract's `worker` field supplies the worker
connection; the shell never imports Angular.

## Run

```bash
npm install
npm run dev    # http://localhost:5180
npm run build  # tsc --noEmit + vite build
```

Sibling hosts: `../vue-host`, `../solid-host`, `../svelte-host`,
`../angular-host` — same five MFEs, different shell.
