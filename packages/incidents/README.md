# @jwhenry123/mesh-incidents

Framework-neutral incident domain library shared by all examples.

It owns the shared-memory and task contracts, worker implementation, worker-pool
singleton, prebuilt task runners (`initIncidentsTask`, `queryIncidentsTask`),
data formatting, and generic table column metadata. Framework apps compose it
with the generic `@jwhenry123/mesh/<framework>` bindings (`useSharedValue`/`useTask`
and friends) — the bindings carry no incident knowledge.

The package is consumed from source through each example's bundler and
TypeScript aliases so `new Worker(new URL(..., import.meta.url))` remains visible
to Vite, Angular, and Next.js worker transforms.
