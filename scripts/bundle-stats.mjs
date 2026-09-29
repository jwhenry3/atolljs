/**
 * Measures the bundle impact of every published @atolljs package — separately
 * for the main-thread and worker-thread entry points — and writes
 * docs-consumer/src/bundleStats.ts for the "Bundle size" docs page.
 *
 * Method: each published export is bundled with rolldown (the Vite 8 bundler)
 * in library mode — dependencies and peer dependencies stay external (the
 * consumer's own bundler resolves/tree-shakes them), output is ES + minified.
 * Sizes are the parsed-module bytes a consumer's bundle would grow by;
 * "gzip" is what crosses the wire.
 *
 * Run: node scripts/bundle-stats.mjs
 */
import { rolldown } from 'rolldown';
import { gzipSync } from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
const OUT = path.join(ROOT, 'docs-consumer/src/bundleStats.ts');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atoll-stats-'));

const fwd = (p) => p.split(path.sep).join('/');

/** A virtual entry that re-exports the given absolute file paths. */
function virtualEntry(name, files) {
  const file = path.join(tmp, `${name}.ts`);
  fs.writeFileSync(
    file,
    files.map((f) => `export * from '${fwd(f)}';`).join('\n') + '\n',
  );
  return file;
}

const isWinAbs = (id) => /^[a-zA-Z]:[\\/]/.test(id);
const isBare = (id) =>
  !id.startsWith('.') &&
  !id.startsWith('/') &&
  !id.startsWith('\0') &&
  !id.startsWith('file:') &&
  !id.startsWith('data:') &&
  !isWinAbs(id);

async function measure(entry, opts = {}) {
  const bundle = await rolldown({
    input: entry,
    // `internal` ids stay bundled even though they're bare — used to measure
    // how much of a dependency a given surface actually pulls (zod facade).
    external: (id) => isBare(id) && !(opts.internal ?? []).some((re) => re.test(id)),
    platform: 'browser',
    resolve: { extensions: ['.tsx', '.ts', '.mjs', '.js', '.jsx', '.json'] },
  });
  const { output } = await bundle.generate({
    format: 'esm',
    minify: true,
  });
  const code = output
    .filter((o) => o.type === 'chunk')
    .map((o) => o.code)
    .join('\n');
  return { min: Buffer.byteLength(code), gzip: gzipSync(code).length };
}

const src = (p) => path.join(ROOT, 'src', p);
const pkg = (p, f) => path.join(ROOT, 'packages', p, 'src', f);

// Shared-by-both-threads core modules (contract, codecs, reactivity, service,
// task, log) — counted on each thread, since each loads its own copy.
const CORE_SHARED = [
  src('contract/sharedMemory.ts'),
  src('contract/listSchema.ts'),
  src('contract/mz.ts'),
  src('contract/msgpackCodec.ts'),
  src('contract/msgpackrCodec.ts'),
  src('service.ts'),
  src('reactive.ts'),
  src('observable.ts'),
  src('task.ts'),
  src('log.ts'),
];
const CORE_MAIN = [
  src('pool/workerClient.ts'),
  src('pool/workerPool.ts'),
  src('pool/memory.ts'),
  src('pool/errors.ts'),
  src('shared/sharedWorkerClient.ts'),
];
const CORE_WORKER = [
  src('worker/defineWorker.ts'),
  src('worker/registry.ts'),
  src('worker/workerBootstrap.ts'),
  src('shared/sharedWorkerHost.ts'),
];

const PACKAGES = [
  {
    id: '@atolljs/core',
    label: 'core',
    main: virtualEntry('core-main', [...CORE_SHARED, ...CORE_MAIN]),
    worker: virtualEntry('core-worker', [...CORE_SHARED, ...CORE_WORKER]),
  },
  { id: '@atolljs/react', label: 'react', main: pkg('react', 'index.ts') },
  { id: '@atolljs/vue', label: 'vue', main: pkg('vue', 'index.ts') },
  { id: '@atolljs/solidjs', label: 'solidjs', main: pkg('solidjs', 'index.ts') },
  { id: '@atolljs/svelte', label: 'svelte', main: pkg('svelte', 'index.ts') },
  { id: '@atolljs/angular', label: 'angular', main: pkg('angular', 'index.ts') },
  { id: '@atolljs/nextjs', label: 'nextjs', main: pkg('nextjs', 'index.ts') },
  { id: '@atolljs/node', label: 'node', main: pkg('node', 'index.ts'), worker: pkg('node', 'shim.ts') },
  { id: '@atolljs/nestjs', label: 'nestjs', main: pkg('nestjs', 'index.ts'), worker: pkg('nestjs', 'worker.ts') },
  { id: '@atolljs/islands', label: 'islands', main: pkg('islands', 'index.ts'), worker: pkg('islands', 'worker/index.ts') },
  { id: '@atolljs/react-island', label: 'react-island', main: pkg('react-island', 'index.tsx'), worker: pkg('react-island', 'worker.ts') },
  { id: '@atolljs/vue-island', label: 'vue-island', main: pkg('vue-island', 'index.ts'), worker: pkg('vue-island', 'worker.ts') },
  { id: '@atolljs/svelte-island', label: 'svelte-island', main: pkg('svelte-island', 'index.ts'), worker: pkg('svelte-island', 'worker.ts') },
  { id: '@atolljs/solid-island', label: 'solid-island', main: pkg('solid-island', 'index.ts'), worker: pkg('solid-island', 'worker.ts') },
  { id: '@atolljs/angular-island', label: 'angular-island', main: pkg('angular-island', 'index.ts'), worker: pkg('angular-island', 'worker.ts') },
];

// Runtime dependencies an end user also installs — measured the same way.
// Entries pin the browser/ESM build a consumer's bundler would pick.
const nm = (p) => path.join(ROOT, 'node_modules', p);
const DEPENDENCIES = [
  // zod as atoll pulls it: bundle our narrowed facade (named imports +
  // $Zod* core classes) with zod kept internal, so rolldown tree-shakes the
  // locales/JSON-schema machinery the `z` namespace object would drag in.
  // The full `z` namespace object measures ~395 kB min — app code doing
  // `import { z } from 'zod'` pays that, not this.
  {
    id: 'zod',
    entry: src('contract/zod.ts'),
    internal: [/^zod(\/|$)/],
    note: 'mz() / listSchema() — atoll pulls a narrowed surface',
  },
  { id: 'msgpackr', entry: nm('msgpackr/index.js'), note: 'msgpackrCodec' },
  { id: '@msgpack/msgpack', entry: nm('@msgpack/msgpack/dist.esm/index.mjs'), note: 'msgpackCodec' },
  { id: 'solid-js', entry: nm('solid-js/dist/solid.js'), note: 'core deps; solidjs/solid-island peers' },
  { id: 'htmlparser2', entry: nm('htmlparser2/dist/index.js'), note: 'islands worker' },
  { id: 'react-reconciler', entry: nm('react-reconciler/cjs/react-reconciler.production.js'), note: 'react-island worker (React apps)' },
];

const result = { generatedAt: new Date().toISOString().slice(0, 10), packages: [], dependencies: [] };

for (const p of PACKAGES) {
  const row = { id: p.id, label: p.label };
  row.main = await measure(p.main);
  if (p.worker) row.worker = await measure(p.worker);
  result.packages.push(row);
  console.log(
    `${p.id.padEnd(28)} main ${(row.main.min / 1024).toFixed(1)}kB` +
      (row.worker ? `  worker ${(row.worker.min / 1024).toFixed(1)}kB` : ''),
  );
}

for (const dep of DEPENDENCIES) {
  try {
    const size = await measure(dep.entry, dep);
    result.dependencies.push({ id: dep.id, note: dep.note, ...size });
    console.log(`${dep.id.padEnd(28)} dep  ${(size.min / 1024).toFixed(1)}kB`);
  } catch (e) {
    console.warn(`skip ${dep.id}: ${e.message}`);
  }
}

fs.writeFileSync(
  OUT,
  '// Generated by scripts/bundle-stats.mjs — do not edit by hand.\n' +
    `export const bundleStats = ${JSON.stringify(result, null, 2)} as const;\n`,
);
console.log(`\nwrote ${path.relative(ROOT, OUT)}`);
fs.rmSync(tmp, { recursive: true, force: true });
