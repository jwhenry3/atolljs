# @atolljs/cli

`atoll` — scaffold worker pools, shared-memory contracts, and framework
islands into a new or existing app.

> **Experimental.** The command grammar and generated code are still
> evolving — expect breaking changes between minor releases.

```
npx @atolljs/cli <command>
# or, once installed: atoll <command>
```

Requires Node ≥ 20.12. The published bin is a bundled `dist/cli.js` —
Node refuses type stripping for `.ts` under `node_modules`, which is
where `npx` installs packages. The TypeScript sources ship alongside it;
`npm run build` (esbuild) regenerates the bundle, and `scripts/publish.mjs`
builds it automatically before staging.

## Commands

```bash
atoll new <dir> [--framework react|vue|solid|svelte|node] [--mfe] [--pm npm]
    Scaffold a fresh app: vite shell with COOP/COEP headers, the
    @atolljs/vite plugin (worker entries are dev-bundled — no
    fast-refresh in workers), a worker-rendered counter island,
    hardened .npmrc — or a tsx Node service with a pooled worker.
    --mfe instead scaffolds a publishable micro-frontend package:
    contract + worker entry + vite.mfe.config.ts (emits a
    self-contained remote bundle) + a dev harness mounting the
    island through the contract.

atoll init
    Wire Atoll into the current project: .npmrc, installs the @atolljs/*
    packages your framework needs, and generates a working spine —
    app.memory.ts + app.worker.ts + app.ts under src/atoll/.

atoll add worker <name>   pooled worker + typed client (browser or node)
atoll add memory <name>   shared-memory contract module
atoll add island <name>   worker-rendered component for your framework
atoll add mfe <name>      publishable micro-frontend — framework-free
                          contract (defineIslandContract) + worker entry
                          attaching it + vite.mfe.config.ts publish build
                          → dist-mfe/<name>.worker.js behind CORS
atoll add devtools [name] observability — src/atoll/devtools.ts init module
                          (import first in the app entry) + @atolljs/devtools
                          dev dep. Browser apps get the ?__atoll_devtools gate;
                          node hosts get the /node entry + ATOLL_DEVTOOLS=1

atoll doctor [--fix]      verify deps, lockfile, .npmrc policy,
                          worker-entry detectability, COOP/COEP headers
```

Existing files are never overwritten without `--force`; missing answers
prompt interactively (or take defaults under `--yes` / no TTY).
