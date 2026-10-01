# svelte-host — a Svelte shell hosting five worker-rendered micro-frontends

One Svelte app mounts islands rendered by **React, Vue, Solid, Svelte, and
Angular** — each in its own `defineMonoWorker` worker, each reached only
through its framework-free contract module in [`../mfe/`](../mfe/README.md).

```svelte
<script lang="ts">
  import { island } from '@atolljs/svelte-island';
  import dialContract from '../../mfe/contracts/dial.contract';
</script>

<div use:island={{ app: dialContract, props: { label: 'level' }, onEvent: (n, p) => … }} />
```

The contract object IS the `app` — its `app` key resolves the registry name
and its `worker` factory supplies the connection, so `use:island` needs no
`worker`/`client` option.

## Run

```bash
npm install
npm run dev    # http://localhost:5183
npm run build  # tsc --noEmit + vite build
```

Sibling hosts: `../react-host`, `../vue-host`, `../solid-host`,
`../angular-host` — same five MFEs, different shell.
