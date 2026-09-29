# @atolljs/incidents

**Private — not published to npm.** Framework-neutral incident domain library
shared by this repo's examples.

It owns the shared-memory and task contracts, worker implementation, worker-pool
singleton, prebuilt task runners (`initIncidentsTask`, `queryIncidentsTask`),
data formatting, and generic table column metadata. Framework apps compose it
with the generic `@atolljs/<framework>` bindings (`useSharedValue`/`useTask`
and friends) — the bindings carry no incident knowledge.

The package is consumed from source through each example's bundler and
TypeScript aliases so `new Worker(new URL(..., import.meta.url))` remains visible
to Vite, Angular, and Next.js worker transforms.

[Atoll — package documentation](https://jwhenry3.github.io/atolljs/consumer/#/quickstart)
