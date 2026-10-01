// Shared build for Node-facing packages (node / nestjs / nextjs / incidents)
// and, via emitTypes(), the root @atolljs/core type surface.
//
// Consumers load these packages through bare Node — compiled app output, or a
// bundled worker entry's `--packages=external` imports — where shipping raw
// src/*.ts dies on ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING. (In-repo it
// never bites: npm file:/workspace links are symlinks, and the node_modules
// check uses the resolved realpath — which is exactly why dev can't catch it.)
//
// Two outputs per build:
//   dist/**/*.js   — esbuild bundles, one per exports leaf (splitting keeps
//                    shared modules as common chunks so module identity —
//                    contracts, registries — can't fork across subpaths)
//   dist/**/*.d.ts — real tsc declarations. Emitting (not stubbing) matters:
//                    sources use extensionless relative imports, which are
//                    legal under bundler resolution but TS2835 under a
//                    consumer's nodenext. tsc emits a mirror of src/, then a
//                    fixup appends `.js` to extensionless relative specifiers
//                    so the .d.ts graph resolves under every mode.
//
// Repo manifests keep `exports` → ./src/ so in-repo dev/tests never touch
// dist/; scripts/publish.mjs rewrites the map to ./dist/ at stage time.
//
// Usage: `node ../../scripts/build-lib.mjs` from the package dir.
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// typescript's exports map doesn't expose ./bin/tsc — resolve it by path.
const tscBin = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
const runTsc = (args, cwd) =>
  execFileSync(process.execPath, [tscBin, ...args], { cwd, stdio: 'inherit' });

const PROBE_EXT = ['.ts', '.tsx', '.js', '.mts'];
const probe = (dir, base) => PROBE_EXT.find((ext) => existsSync(join(dir, `${base}${ext}`)));

/** Flatten an exports map to leaf specifier strings. */
function exportLeaves(exports) {
  const leaves = [];
  const collect = (v) => {
    if (typeof v === 'string') leaves.push(v);
    else if (v && typeof v === 'object') Object.values(v).forEach(collect);
  };
  Object.values(exports ?? {}).forEach(collect);
  return leaves;
}

/** Derive esbuild entries from the exports map's ./src/ leaves. */
export function srcEntries(dir, exports) {
  const entries = [];
  for (const leaf of exportLeaves(exports)) {
    const m = /^\.\/src\/(.+)$/.exec(leaf);
    if (!m) continue;
    const rel = m[1];
    if (rel.endsWith('*')) {
      const sub = rel.slice(0, -1).replace(/\/$/, '');
      for (const f of readdirSync(join(dir, 'src', sub))) {
        if (/\.tsx?$/.test(f) && !f.endsWith('.d.ts')) entries.push(join('src', sub, f));
      }
    } else {
      const name = rel.replace(/\.tsx?$/, '');
      const ext = probe(dir, join('src', name));
      if (ext) entries.push(join('src', `${name}${ext}`));
      else console.warn(`build-lib: ${leaf} — no source file found, skipping`);
    }
  }
  return entries;
}

/** esbuild the entries into dist/ (ESM, node platform, all packages external). */
export async function bundleEntries(dir, entries) {
  await build({
    entryPoints: entries,
    outdir: join(dir, 'dist'),
    outbase: 'src',
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'node',
    target: 'node20.12',
    packages: 'external',
    logLevel: 'warning',
  });
}

/**
 * Emit real .d.ts for every file in <pkgDir>/src via a generated
 * tsconfig.build-lib.json, then copy this package's own subtree into dist/.
 * rootDir is the repo root so transitively-imported sibling sources can't
 * trip TS6059 — their emitted files are simply not copied.
 */
export function emitTypes(pkgDir) {
  const config = {
    extends: './tsconfig.json',
    compilerOptions: {
      noEmit: false,
      declaration: true,
      emitDeclarationOnly: true,
      rootDir: '../..',
      outDir: 'dist-raw',
    },
    include: ['src'],
  };
  writeFileSync(join(pkgDir, 'tsconfig.build-lib.json'), JSON.stringify(config, null, 2) + '\n');
  try {
    runTsc(['-p', 'tsconfig.build-lib.json'], pkgDir);
  } finally {
    rmSync(join(pkgDir, 'tsconfig.build-lib.json'), { force: true });
  }
  const mirror = join(pkgDir, 'dist-raw', relative(join(pkgDir, '..', '..'), pkgDir), 'src');
  if (!existsSync(mirror)) throw new Error(`build-lib: no declarations emitted at ${mirror}`);
  copyDir(mirror, join(pkgDir, 'dist'));
  rmSync(join(pkgDir, 'dist-raw'), { recursive: true, force: true });
}

function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  for (const f of readdirSync(from)) {
    const s = join(from, f);
    const d = join(to, f);
    if (statSync(s).isDirectory()) copyDir(s, d);
    else writeFileSync(d, readFileSync(s));
  }
}

/**
 * Append `.js` to extensionless relative specifiers in emitted .d.ts — tsc
 * preserves the sources' bundler-resolution style, which nodenext rejects.
 */
export function fixDtsSpecifiers(distDir) {
  const fixFile = (file) => {
    const src = readFileSync(file, 'utf8');
    const fixed = src.replace(
      /(from\s+['"]|import\s*\(\s*['"])(\.{1,2}\/[^'"]+?)(['"])/g,
      (all, pre, spec, post) =>
        /\.(?:js|mjs|cjs|json|d\.ts)$/.test(spec) ? all : `${pre}${spec}.js${post}`,
    );
    if (fixed !== src) writeFileSync(file, fixed);
  };
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.d.ts')) fixFile(p);
    }
  };
  walk(distDir);
}

/**
 * Rewrite a staged manifest's ./src/ exports leaves to their ./dist/ targets.
 * A leaf is only rewritten when its dist target exists — the existence check
 * makes the exports↔build coupling self-verifying. Shared with publish.mjs.
 */
export function rewriteExportsLeaf(dir, leaf, isTypes) {
  const m = /^\.\/src\/(.+)$/.exec(leaf);
  if (!m) return leaf;
  const rel = m[1];
  if (rel.endsWith('*')) {
    const sub = rel.slice(0, -1).replace(/\/$/, '');
    try {
      if (readdirSync(join(dir, 'dist', sub)).length === 0) return leaf;
    } catch {
      return leaf; // no dist dir — leave the src mapping alone
    }
    return isTypes ? `./dist/${sub}/*.d.ts` : `./dist/${sub}/*.js`;
  }
  const name = rel.replace(/\.tsx?$/, '');
  if (!existsSync(join(dir, 'dist', `${name}.js`))) return leaf;
  return isTypes ? `./dist/${name}.d.ts` : `./dist/${name}.js`;
}

// An entry: bare string → {types, default} conditional; a conditional object
// → each leaf rewritten by its condition key (types→.d.ts, else→.js).
function rewriteExportsVal(dir, val, isTypes = false) {
  if (typeof val === 'string') {
    const js = rewriteExportsLeaf(dir, val, isTypes);
    // A top-level leaf that rewrote gains a types condition pointing at the
    // emitted .d.ts.
    if (js !== val && !isTypes) {
      return { types: rewriteExportsLeaf(dir, val, true), default: js };
    }
    return js;
  }
  return Object.fromEntries(
    Object.entries(val).map(([k, v]) => [k, rewriteExportsVal(dir, v, isTypes || k === 'types')]),
  );
}

export function rewriteExports(dir, exports) {
  return Object.fromEntries(
    Object.entries(exports).map(([k, v]) => [k, rewriteExportsVal(dir, v)]),
  );
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === join(process.argv[1]);
if (isMain) {
  const dir = process.cwd();
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const entries = srcEntries(dir, pkg.exports);
  if (entries.length === 0) {
    console.warn(`${pkg.name}: no ./src/ exports found — nothing to build`);
  } else {
    await bundleEntries(dir, entries);
    emitTypes(dir);
    fixDtsSpecifiers(join(dir, 'dist'));
    console.log(`${pkg.name}: ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} → dist/ (js + d.ts)`);
  }
}
