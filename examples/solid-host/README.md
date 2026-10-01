# solid-host — a Solid shell hosting five worker-rendered micro-frontends

One Solid app (built on `solid-js/html` tagged templates — no JSX compile
step needed) mounts islands rendered by **React, Vue, Solid, Svelte, and
Angular** — each in its own `defineMonoWorker` worker, each reached only
through its framework-free contract module in [`../mfe/`](../mfe/README.md).

```ts
import { islandComponent } from '@atolljs/solid-island';
import tickerContract from '../../mfe/contracts/ticker.contract';
const TickerIsland = islandComponent(tickerContract); // Solid in the worker
TickerIsland({ label: 'pulse', intervalMs: 1000, onEvent: (n, p) => … });
```

Props type off the contract's prop schema; `onEvent` narrows to the
contract's declared vocabulary. The contract's `worker` field supplies the
connection.

## Run

```bash
npm install
npm run dev    # http://localhost:5182
npm run build  # tsc --noEmit + vite build
```

Sibling hosts: `../react-host`, `../vue-host`, `../svelte-host`,
`../angular-host` — same five MFEs, different shell.
