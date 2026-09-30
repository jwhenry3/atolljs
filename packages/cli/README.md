# @atolljs/cli

`atoll` — scaffold worker pools, shared-memory contracts, and framework
islands into a new or existing app.

```
npx @atolljs/cli <command>
# or, once installed: atoll <command>
```

Requires Node ≥ 22.18 — the bin ships as TypeScript and runs under Node's
native type stripping.

## Commands

```bash
atoll new <dir> [--framework react|vue|solid|svelte|node] [--pm npm]
    Scaffold a fresh app: vite shell with COOP/COEP headers, a
    worker-rendered counter island, hardened .npmrc — or a tsx Node
    service with a pooled worker.

atoll init
    Wire Atoll into the current project: .npmrc, installs the @atolljs/*
    packages your framework needs, and generates a working spine —
    app.memory.ts + app.worker.ts + app.ts under src/atoll/.

atoll add worker <name>   pooled worker + typed client (browser or node)
atoll add memory <name>   shared-memory contract module
atoll add island <name>   worker-rendered component for your framework

atoll doctor [--fix]      verify deps, lockfile, .npmrc policy,
                          worker-entry detectability, COOP/COEP headers
```

Existing files are never overwritten without `--force`; missing answers
prompt interactively (or take defaults under `--yes` / no TTY).
