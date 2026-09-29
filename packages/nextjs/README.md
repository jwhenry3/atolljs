# @atolljs/nextjs

Next.js bindings for `@atolljs/core` — the `@atolljs/react` hooks re-exported
for App Router apps. Same signatures, imported by client components under a
`'use client'` boundary. SSR-safe: field reads return `undefined` until the
contract binds on the client.

**[Atoll — package documentation](https://jwhenry3.github.io/atolljs/consumer/#/quickstart)**

## Install

```bash
npm install @atolljs/core @atolljs/nextjs
```

## Usage

```tsx
'use client';   // required — the hooks read browser-side state

import { useSharedValue, useTask } from '@atolljs/nextjs';
import { counterMemory } from '../counter.memory';
import { counter } from '../counter';   // connectWorker client — safe to import under SSR

export function Counter() {
  const count = useSharedValue(counterMemory, 'count');
  const increment = useTask(counter.increment);  // client method → latest-wins task

  return (
    <button onClick={() => increment.run(1)}>
      count: {count ?? '…'}
    </button>
  );
}
```

## API

Same surface as `@atolljs/react`:

- `useObservable(source)` — subscribe to any `ObservableValue` snapshot.
- `useSharedValue(memory, key, select?, options?)` — bind one shared-memory
  field to React state; optional selector + `equals`.
- `useTask(task | asyncFn)` — bind an `AsyncTask` (or any async fn) to
  `{ data, pending, settled, elapsedMs, error }` plus `run`/`runOnce`.

## Notes

- `'use client'` is required on any component calling the hooks; `page.tsx`
  can stay a server component that just renders it.
- The `connectWorker` client is SSR-safe to import — its pool spawns lazily on
  the first method call, never during a server render.
- COOP/COEP headers in `next.config.ts` are only needed when the pool uses
  `sharedMemory`; a message-only pool needs neither headers nor
  `SharedArrayBuffer`.
- Server-side pools work too: route handlers run on Node, so
  `@atolljs/node` (`createNodePool`/`createNodeWorker`) gives a handler its
  own `node:worker_threads` pool — see `examples/nextjs/src/app/api/atoll/`.
- Requires a Node runtime (`next start`, a Node host, Vercel) — static file
  hosts can't render the app or answer route handlers.

## Documentation

- [Atoll — package documentation](https://jwhenry3.github.io/atolljs/consumer/#/quickstart)
- [Next.js guide](https://jwhenry3.github.io/atolljs/consumer/#/fw-nextjs)
