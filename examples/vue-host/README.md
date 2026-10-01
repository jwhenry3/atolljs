# vue-host — a Vue shell hosting five worker-rendered micro-frontends

One Vue app mounts islands rendered by **React, Vue, Solid, Svelte, and
Angular** — each in its own `defineMonoWorker` worker, each reached only
through its framework-free contract module in [`../mfe/`](../mfe/README.md).

```vue
<script setup lang="ts">
import { islandComponent } from '@atolljs/vue-island';
import counterContract from '../../mfe/contracts/counter.contract';
const CounterIsland = islandComponent(counterContract); // React in the worker
</script>

<CounterIsland v-bind="{ label: 'alpha', onEvent: (n, p) => … }" />
```

Attrs that aren't shell keys forward as the island's props; `onEvent`
receives the contract's declared event payloads. The contract's `worker`
field supplies the connection.

## Run

```bash
npm install
npm run dev    # http://localhost:5181
npm run build  # tsc --noEmit + vite build
```

Sibling hosts: `../react-host`, `../solid-host`, `../svelte-host`,
`../angular-host` — same five MFEs, different shell.
