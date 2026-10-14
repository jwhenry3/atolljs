# @atolljs/nx

Nx plugin for [`@atolljs/cli`](../cli) — generators and executors that drive
the `atoll` bin inside an Nx workspace.

> **Experimental.** Same status as the CLI it wraps — expect breaking changes
> between minor releases.

```
npm i -D @atolljs/nx
```

Requires Node ≥ 20.12 and an Nx workspace (`nx` ≥ 19). The generators don't
reimplement the CLI — they resolve your project, translate Nx options into
CLI flags, and spawn the `atoll` bin (`@atolljs/cli`, installed automatically
as a dependency). Everything the CLI prints — next steps, install offers —
still applies.

## Generators

```bash
nx g @atolljs/nx:init --project=web
    atoll init scoped to a project — spine (<name>.memory.ts + .worker.ts +
    .ts) lands in <sourceRoot>/atoll/, .npmrc + dependency installs at the
    workspace root. Also runs on `nx add @atolljs/nx` (with no --project it
    targets the workspace root).

nx g @atolljs/nx:worker <name> [--project <p>]      atoll add worker
nx g @atolljs/nx:memory <name> [--project <p>]      atoll add memory
nx g @atolljs/nx:island <name> [--variant facade|mono] [--project <p>]
nx g @atolljs/nx:mfe <name> [--project <p>]
nx g @atolljs/nx:service|method|module|housed <name>   (nestjs projects)
nx g @atolljs/nx:route|component|instrumentation <name> (nextjs projects)
nx g @atolljs/nx:devtools [name] [--project <p>]
```

Options (see each generator's schema — `nx g @atolljs/nx:worker --help`):

- `--project` — files land under the project's `sourceRoot` (`atoll/` for
  pools/contracts/services, `islands/`, `mfe/`, `app/api/<name>` for routes).
  The CLI runs *inside* the project dir, so a project-level `package.json`
  wins framework detection; without one detection falls back to the
  workspace root.
- `--directory` — explicit output dir (workspace-root-relative), overriding
  the project-derived default.
- `--framework` — pass-through to `atoll --framework` when the root
  package.json describes a different stack than the target project.
- `--variant`, `--memory`, `--no-memory`, `--force`, `--install`.

`--dry-run` is honored: generators print the `atoll` command they would run
instead of writing files (the plugin reads `NX_DRY_RUN`, same as any nx
generator). **The CLI writes directly to disk** rather than through Nx's
virtual tree — file writes don't appear in `tree.listChanges()`, and
`nx format`-style post-processing doesn't apply.

`atoll new` has no generator — apps are created by your workspace's own
generators; then run `init` / `add`. `atoll convert vite` likewise stays a
CLI invocation (`npx @atolljs/cli convert vite`).

## Executors

Register as targets in `project.json` (or `package.json#nx`):

```jsonc
{
  "targets": {
    "atoll-doctor": {
      "executor": "@atolljs/nx:doctor",
      "options": { "fix": true }
    },
    "atoll-devtools": {
      "executor": "@atolljs/nx:devtools",
      "options": { "port": 4780 }
    }
  }
}
```

```bash
nx run web:atoll-doctor      # checks deps, .npmrc policy, worker-entry
                             # detectability, COOP/COEP headers
nx run web:atoll-devtools    # serves the dashboard until stopped —
                             # pool timings, shared-memory writes, islands
```

`devtools` options: `port`, `otlp`, `otlpHeaders`, `otlpService` — same as
`atoll devtools --help`. Apps connect via `connectDevtools()` — see
`nx g @atolljs/nx:devtools` for the app-side init module.

## Layout

```
src/atoll.ts       resolve @atolljs/cli's bin + spawn helpers
src/generators.ts  initGenerator + one factory per `atoll add` kind
src/executors.ts   doctorExecutor + devtoolsExecutor
src/schemas/       JSON schemas for the registry files
```

The published artifact is a single CJS bundle (`dist/index.cjs`) — Nx loads
factories via `require(path#export)`. `npm run build` regenerates it.
