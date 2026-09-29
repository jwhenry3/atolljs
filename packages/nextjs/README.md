# @atolljs/nextjs

Next.js bindings for `@atolljs/core` — re-exports `@atolljs/react`,
which works as-is inside `'use client'` boundaries. SSR-safe: field
observables read `undefined` until the contract binds on the client.

The consuming app composes these with its own contracts and tasks.
