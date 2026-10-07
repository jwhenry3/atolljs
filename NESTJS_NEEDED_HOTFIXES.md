# Hotfixes needed: `@atolljs/*@0.1.8` consumer NestJS + React scaffold

Found while scaffolding a fresh consumer app (`npx @nestjs/cli new` +
`npm create vite -- --template react-ts`, then `atoll init`) on 2026-10-07,
Node 26.7 / npm 11.20, against the **published** npm packages. Each item lists
the consumer symptom, root cause, and the fix needed on our side.

> **Status (updated 2026-10-07):** 1, 3, 4, 5, 6, 7, 8 are fixed in the tree;
> 2 has a documented workaround (full fix pending); 9 is documented.
> The example itself now builds with Vite instead of webpack, which sidesteps
> items 2 and 7 for the recommended path entirely.

## Blockers

### 1. `@atolljs/nestjs` peer range excludes Nest 12 — FIXED

`nest new` today installs `@nestjs/common@12.x`; our peer range is
`^11.1.0`, so `atoll init` dies at install with ERESOLVE.

- **Fix:** verify compat and widen to `"^11.1.0 || ^12.0.0"` (the APIs we
  touch, `Module`/`Injectable`/`DiscoveryService`/`NestFactory` app context,
  are stable across 11 to 12). Until then, consumers must downgrade:
  `npm i @nestjs/common@^11 @nestjs/core@^11 @nestjs/platform-express@^11 @nestjs/testing@^11 @nestjs/cli@^11 @nestjs/schematics@^11`
  (all must move together, `@nestjs/testing` pins `core` too).
- CLI should detect the peer conflict and print this, or offer
  `--legacy-peer-deps`.
- **Status:** peer range widened to `"^11.1.0 || ^12.0.0"`; 28/28 package
  tests pass on Nest 12.1.2. `atoll init` now prints a Nest-specific
  ERESOLVE hint (supported majors, `--legacy-peer-deps`) when the install
  step fails.

### 2. ESM-only dist exports break under Nest's webpack bundle — WORKAROUND DOCUMENTED

`exports["."]` declares only `"import"`. `nest build` (webpack:true) emits
`commonjs2` and `nodeExternals()` leaves `@atolljs/*` as runtime
`require()` calls, so boot crashes with `ERR_PACKAGE_PATH_NOT_EXPORTED`.
`examples/nestjs` never hits this because tsconfig `paths` alias
`@atolljs/*` to `../../src/*.ts`, bundling the sources directly.

- **Fix (best):** ship a `"require"`/`"default"` condition in exports for
  the Node-facing packages (node, nestjs) — they already build real dist.
  Still open: requires a dual CJS emit in `scripts/build-lib.mjs`.
- **Fix (minimal):** document or generate the webpack workaround:
  `config.externals = [nodeExternals({ allowlist: [/^@atolljs\//] })]` so
  webpack bundles our ESM dist instead of requiring it.
- **Status:** minimal fix applied — the workaround is documented in
  `docs/frameworks/nestjs.md`. The recommended path (Vite SSR build, ESM
  output) never hits this.

### 3. CLI template emits `mz`, which is not exported by `@atolljs/core@0.1.8` — FIXED

Generated `src/atoll/app.memory.ts` does `import { ..., mz }` and
`mz.object(...)`; published core exports `reef`. `tsc` fails with TS2305 on
a fresh scaffold.

- **Fix:** update the init/add templates from `mz.*` to `reef.*`.
- **Status:** templates emit `reef` (packages/cli/src/templates.ts).

### 4. Generated `.npmrc` blocks the atoll packages themselves — FIXED

`atoll init` writes `min-release-age=7`, but every published `@atolljs/*`
version is currently younger than 7 days, so afterwards `npm i @atolljs/vite`
and even `npx @atolljs/cli doctor` fail with ENOVERSIONS inside the freshly
created project.

- **Fix:** append `min-release-age-exclude[]=@atolljs/<pkg>` lines (npm
  11.10+ supports the exclude list) for the packages init installs, so the
  policy applies to supply-chain deps but not to us.
- **Status:** the generated `.npmrc` now carries
  `min-release-age-exclude[]=@atolljs/*` (glob form covers every package),
  and the one-time bootstrap install still runs with
  `--min-release-age=0` as a fallback for older npm.

## Scaffold correctness

### 5. `atoll init` writes the wrong spine for NestJS — FIXED

In a nestjs project init generates the generic node spine:
`createNodePool` + `new Worker(new URL('../../dist/app.worker.js'))` +
a comment telling the user to esbuild the worker. Under the webpack build
that file is never emitted, and `app.ts` is unreachable in the webpack
graph anyway, so the "working" spine silently does nothing. Meanwhile
`atoll add service <name>` generates the correct DI-native spine
(`registerPool` + `runAtollWorker` + webpack-detectable
`new URL('./x.worker.ts', import.meta.url)`).

- **Fix:** for detected `nestjs` projects, init should emit the
  module/service/worker spine directly (or a registerPool module only),
  not the raw node pool.
- **Status:** init now emits `src/atoll/<name>.memory.ts` +
  `@AtollService` facade + `registerPool` module + worker entry (the same
  files `add nestjs service` generates), with next-steps pointing at the
  module import and the `.worker.js` build input.

### 6. `atoll init` aborts mid-run on install failure — FIXED

Ordering is `.npmrc` → install → spine files. When install fails (item 1),
the project is left half-wired and a retry needs `--min-release-age=0`
(see item 4). Consider installing deps last, or resuming cleanly.

- **Status:** install now runs last (`.npmrc` → spine files → install), so
  a failed install leaves a complete scaffold; plus the item-4 exclude
  means the most common failure no longer happens at all.

### 7. Nest 12 default scaffold is ESM; our example assumes CJS — FIXED

New `nest new` output is `"type": "module"`, `module: nodenext`, `.js`
import extensions. With `webpack:true` the emitted `main.js` is commonjs2,
which does not run under `type: module`. The consumer must (as the
examples do): drop `"type": "module"`, use extensionless relative imports,
and set tsconfig `module: ESNext` + `moduleResolution: bundler`.

- **Fix:** document this in `docs/frameworks/nestjs.md`, or have
  `atoll doctor` flag the combination.
- **Status:** the example is now `"type": "module"` with a Vite ESM build,
  matching Nest 12's scaffold defaults — documented in
  `docs/frameworks/nestjs.md`. The CJS downgrade is only needed on the
  webpack path (also documented).

## Minor

### 8. `import 'reflect-metadata'` must lead `main.ts` — NO CHANGE NEEDED

Nest 12's template drops it; the webpack bundle needs it before any
decorated class loads. `examples/nestjs/src/main.ts` has it right, and the
CLI-generated housed worker entry also leads with it.

### 9. `poolSize: 'auto'` spawns `hardwareConcurrency` workers eagerly — DOCUMENTED

`registerPool` constructs the pool at module init; on a 24-core dev box
that is 24 Nest application contexts booting per `nest start`. Consider
capping the default for dev or documenting it.

- **Status:** documented in `docs/frameworks/nestjs.md` (Notes). The
  example deliberately keeps `'auto'` on the incidents pool to showcase
  the spread across threadIds.

## Verified working consumer config (for reference)

**Recommended: Vite SSR build** (what `examples/nestjs` now uses — `"type":
"module"`, Nest 12, ESM throughout). `atoll convert vite` applies this
migration to an existing NestJS project — writes the config below plus
`dev.mjs`, rewrites `*.worker.ts` URLs to the emitted `.worker.js` names,
and patches `package.json`/`tsconfig.json`:

```ts
// vite.config.ts
import { globSync } from 'node:fs';
import { basename } from 'node:path';
import { defineConfig } from 'vite';

const workerInputs = Object.fromEntries(
  globSync('src/**/*.worker.ts').map((f) => [basename(f, '.ts'), f]),
);

export default defineConfig({
  build: {
    ssr: true,
    outDir: 'dist',
    rollupOptions: {
      input: { main: 'src/main.ts', ...workerInputs },
      output: { entryFileNames: '[name].js', chunkFileNames: '[name]-[hash].js' },
    },
  },
});
```

Pool factories reference the emitted bundle:
`new Worker(new URL('./x.worker.js', import.meta.url))`. No externals
workaround, no webpack pin, and the Nest 12 ESM scaffold works as-is.

**Alternative: `nest build` + webpack** (verified on Nest 11.2.7):

`nest-cli.json`:

```json
{
  "compilerOptions": {
    "builder": {
      "type": "webpack",
      "options": { "configPath": "webpack.config.js" }
    }
  }
}
```

`webpack.config.js`:

```js
const nodeExternals = require('webpack-node-externals');

module.exports = (config) => {
  config.externals = [nodeExternals({ allowlist: [/^@atolljs\//] })];
  return config;
};
```

Requires webpack <5.108 (the `.wc` worker-callee regression), the externals
allowlist from item 2, and no `"type": "module"` in package.json. With
those in place `nest build` emits the worker chunk and dispatch works.
