# Next.js — `@atolljs/nextjs`

Read when: working on `packages/nextjs/` or `examples/nextjs/`.

React re-export for App Router apps — the same hooks, packaged so client
components import them under a `'use client'` boundary while server components
never touch `Worker`. Source: `packages/nextjs/src/index.ts`. Example:
`examples/nextjs/src/useIncidents.ts`, `examples/nextjs/src/IncidentsApp.tsx`.

| Export | Signature | What it does |
|---|---|---|
| `useObservable` | `useObservable(source: ObservableValue<T>): T` | Subscribe to any observable snapshot (task or field). |
| `useSharedValue` | `useSharedValue(memory, key, select?, options?): T \| undefined` | Bind one shared-memory field to React state; optional selector + equality to slice updates. |
| `useTask` | `useTask(task \| asyncFn): { data, pending, settled, elapsedMs, error, run, runOnce }` | Bind an AsyncTask — or any async fn (e.g. a client method, wrapped via `toTask`) — to state and get its triggers. |

```tsx
'use client';   // required — the hooks read browser-side state

import { useSharedValue, useTask } from '@atolljs/nextjs';
import { counterMemory } from '../counter.memory';
import { counter } from '../counter';   // connectWorker client — safe to import under SSR

export function Counter() {
  const count = useSharedValue(counterMemory, 'count');
  const increment = useTask(counter.increment);  // client method → latest-wins task
  return <button onClick={() => increment.run(1)}>count: {count ?? '…'}</button>;
}
```

Notes:

- Components using the hooks carry the `'use client'` directive — the app
  boundary component is the edge; `app/page.tsx` can stay a server component
  that just renders it.
- Importing the `connectWorker` client is SSR-safe: the pool spawns lazily on
  the first method call, never during a server render.
- The COOP/COEP `headers()` in `next.config.ts` are only needed when the pool
  uses `sharedMemory` — a message-only pool needs neither the headers nor
  `SharedArrayBuffer`.
- Next.js is server-rendered, so it isn't copied into the unified `dist/`
  tree — `next start` serves it on its own port.
