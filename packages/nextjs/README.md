# @jwhenry123/mesh-nextjs

Next.js bindings for `@jwhenry123/mesh/sdk` — re-exports `@jwhenry123/mesh-react`,
which works as-is inside `'use client'` boundaries. SSR-safe: field
observables read `undefined` until the contract binds on the client.

The consuming app composes these with its own contracts and tasks.
