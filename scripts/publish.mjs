// Lockstep staged publish — `node scripts/publish.mjs <version|v*.*.*> [pkg] [--dry-run]`.
//
// An optional package positional (`@atolljs/devtools`, `devtools`, or
// `packages/devtools`) narrows the run to that one package — its manifest
// alone is stamped; internal deps still stamp to the release version.
//
// Stamps every publishable package.json (repo root = @atolljs/core, plus
// packages/* — private packages are skipped) with the release version,
// rewrites internal @atolljs/* dep ranges to match, then `npm stage
// publish`es in dependency order: atoll → node/react → the rest. Staged
// versions sit in npm's stage queue (not installable) until a maintainer
// approves with 2FA — `npm stage list/view/approve` or the Staged Packages
// tab on npmjs.com. CI runs this from a release tag; repo versions stay
// 0.0.0 as a "not yet released" marker. Requires npm CLI >= 11.15.0.
//
// `--direct` swaps `npm stage publish` for a plain `npm publish` — the
// one-time bootstrap, since staging requires the package to already exist
// on the registry. Run it interactively (2FA prompts per package) to create
// each package; provenance is dropped since it needs Actions OIDC.
//
// Without `--direct` the run pre-flights `npm view` on every package BEFORE
// stamping or staging: a confirmed 404 (a new package staging can't create)
// aborts immediately rather than leaving a release half-staged.
//
// Re-runs are safe: a package whose target version is already published (or
// staged, pending approval) is skipped rather than hard-failing — so a
// partially-completed release can just be run again.
//
// Stamped manifests are restored to their pre-run bytes on exit (byte-for-
// byte, not `git checkout` — uncommitted edits survive and no git is
// needed). A stamped package.json must never reach a commit.
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { rewriteExports } from './build-lib.mjs';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const [, , tag, ...rest] = process.argv;
const dryRun = rest.includes('--dry-run');
const direct = rest.includes('--direct');

const version = tag?.replace(/^v/, '');
if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error(
    `usage: node scripts/publish.mjs <semver|vSemver> [package] [--direct] [--dry-run] — got "${tag ?? ''}"`,
  );
  process.exit(1);
}
// Optional second positional narrows the run to one package — accepts the
// scoped name (@atolljs/devtools), the unscoped part (devtools), or the
// directory (packages/devtools). Internal deps still stamp to `version`.
const only = rest.find((a) => !a.startsWith('--'));

const REGISTRY = 'https://registry.npmjs.org';

const read = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

// Collect publishable packages: root + non-private packages/*.
const packages = [{ dir: root, pkg: read(root) }];
for (const name of readdirSync(join(root, 'packages'))) {
  const dir = join(root, 'packages', name);
  if (!statSync(dir).isDirectory()) continue;
  const pkg = read(dir);
  if (!pkg.private) packages.push({ dir, pkg });
}
const names = new Set(packages.map((p) => p.pkg.name));

// The full `names` set stays needed for dep rewriting; `selected` is what
// builds/stamps/stages this run.
const selected = only
  ? packages.filter(
      ({ dir, pkg }) =>
        pkg.name === only ||
        pkg.name.replace(/^@[^/]+\//, '') === only ||
        relative(root, dir) === only ||
        relative(root, dir) === join('packages', only),
    )
  : packages;
if (only && selected.length === 0) {
  console.error(
    `unknown package "${only}" — publishable:\n  ` +
      packages.map((p) => p.pkg.name).join('\n  '),
  );
  process.exit(1);
}

/* ── Pre-flight: staging can't create packages ────────────────────────────
 * `npm stage publish` requires the package to already exist on the
 * registry. Discovering that MID-RUN leaves a partial stage — earlier
 * packages staged, the new one failed, docs-snapshot skipped. Gate on
 * `npm view` up front instead: a confirmed 404 aborts before any package
 * stages (and before version stamping dirties the working tree). Skipped
 * under --direct — a direct publish IS the bootstrap.
 */
if (!direct) {
  const missing = [];
  for (const { dir, pkg } of selected) {
    const res = spawnSync('npm', ['view', pkg.name, 'name', '--registry', REGISTRY], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    if (res.status === 0) continue;
    if (/E404|404/.test(res.stderr ?? '')) {
      missing.push({ name: pkg.name, dir: relative(root, dir) || '.' });
    } else {
      // Network/auth hiccup — inconclusive, not a confirmed miss. The stage
      // step remains the real gate.
      console.warn(
        `WARN ${pkg.name}: registry check inconclusive — ` +
          (res.stderr || String(res.error ?? 'npm view failed')).trim().split('\n')[0],
      );
    }
  }
  if (missing.length > 0) {
    const msg =
      `\n${missing.map((m) => `  ${m.name}`).join('\n')}\n\n` +
      `${missing.length} package(s) don't exist on npm — \`npm stage publish\` cannot create them.\n` +
      `Bootstrap each first (one-time, interactive 2FA):\n` +
      missing.map((m) => `  (cd ${m.dir} && npm publish)`).join('\n') +
      `\n\npublishConfig.access is already "public" — then re-run this release.`;
    if (dryRun) console.warn(`[dry-run] would abort before staging:${msg}`);
    else {
      console.error(msg);
      process.exit(1);
    }
  }
}

/* ── Build compiled bundles before staging ───────────────────────────────
 * Packages that run under node_modules as plain JS (@atolljs/cli's bin,
 * @atolljs/vite's plugin entry) ship dist/ because Node refuses type
 * stripping for files under node_modules (ERR_UNSUPPORTED_NODE_MODULES_
 * TYPE_STRIPPING) — exactly where npm installs them. src/ still ships in
 * the tarball for transparency; dev runs the .ts sources directly (npm run
 * atoll / vitest / CI smoke). A missing dist/ would stage a package whose
 * entry resolves to nothing — build (and smoke the cli bin) here, for real
 * runs and dry-runs (so pack --dry-run lists the bundles).
 */
for (const { dir, pkg } of selected) {
  if (!pkg.scripts?.build) continue;
  console.log(`build: ${pkg.name} — npm run build`);
  try {
    execFileSync('npm', ['run', 'build'], {
      cwd: dir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (pkg.bin) {
      execFileSync('node', [Object.values(pkg.bin)[0], '--help'], { cwd: dir, stdio: 'ignore' });
    }
  } catch {
    throw new Error(`${pkg.name} bundle build/smoke failed — see output above`);
  }
}

/* ── Node-facing packages: exports → dist at stage time ──────────────────
 * Packages built by scripts/build-lib.mjs (node/nestjs/nextjs/incidents)
 * keep `exports` → ./src/ in the repo so in-repo dev/tests resolve sources.
 * Published consumers load them through bare Node (compiled app output,
 * bundled worker entries' external imports), where .ts under node_modules
 * dies on ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING — so the staged
 * manifest rewrites each ./src/ leaf to its emitted ./dist/ file, and
 * `types` to the real .d.ts build-lib emits alongside. Rewrite lives in
 * build-lib.mjs so pack/verify flows exercise the same code.
 */

// Stamp version + rewrite internal dep ranges to the release version —
// only the selected package's manifest changes on a single-package run.
// Stamped manifests are stage-time artifacts: capture each original before
// writing and restore it verbatim on the way out (success, failure, or
// Ctrl+C). Repo convention stays `0.0.0` + `exports` → `./src` — a
// `git add -A` after publishing must never sweep stamped state into a
// commit.
const stamped = new Map(); // manifest path → original text
for (const { dir, pkg } of selected) {
  pkg.version = version;
  if (pkg.scripts?.build?.includes('build-lib.mjs') && pkg.exports) {
    pkg.exports = rewriteExports(dir, pkg.exports);
  }
  for (const field of ['dependencies', 'peerDependencies', 'devDependencies']) {
    for (const dep of Object.keys(pkg[field] ?? {})) {
      if (names.has(dep)) pkg[field][dep] = version;
    }
  }
  if (!dryRun) {
    const manifest = join(dir, 'package.json');
    if (!stamped.has(manifest)) stamped.set(manifest, readFileSync(manifest, 'utf8'));
    writeFileSync(manifest, JSON.stringify(pkg, null, 2) + '\n');
  }
}

const restoreManifests = () => {
  for (const [p, original] of stamped) writeFileSync(p, original);
  if (stamped.size) {
    console.log(`restored ${stamped.size} manifest(s) — stamped state is publish-only`);
    stamped.clear();
  }
};
process.on('exit', restoreManifests);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    restoreManifests();
    process.exit(sig === 'SIGINT' ? 130 : 143);
  });
}

// Dependency order — a package publishes after every internal dep it needs.
const order = [
  '@atolljs/core',
  '@atolljs/node',
  '@atolljs/react',
  // react-island peers on islands — publish the dep first.
  '@atolljs/islands',
  '@atolljs/react-island',
  // devtools peers on core — stage after it so its stamped dep resolves.
  '@atolljs/devtools',
];
const sorted = [...selected].sort(
  (a, b) => (order.indexOf(a.pkg.name) === -1 ? 99 : order.indexOf(a.pkg.name)) -
            (order.indexOf(b.pkg.name) === -1 ? 99 : order.indexOf(b.pkg.name)),
);

// Single-package runs break the lockstep assumption: internal deps stamp to
// `version` whether or not that version exists yet. Warn — a published
// package whose @atolljs/* deps aren't out there can't be installed.
if (only) {
  for (const { pkg } of selected) {
    for (const field of ['dependencies', 'peerDependencies']) {
      for (const dep of Object.keys(pkg[field] ?? {})) {
        if (!names.has(dep)) continue;
        const res = spawnSync('npm', ['view', `${dep}@${version}`, 'version', '--registry', REGISTRY], {
          encoding: 'utf8',
          shell: process.platform === 'win32',
        });
        if (res.status !== 0) {
          console.warn(
            `WARN ${pkg.name} ${field} ${dep}@${version} isn't on npm yet — ` +
              `this package won't be installable until ${dep} publishes too`,
          );
        }
      }
    }
  }
}

/* ── Transparency preamble ──────────────────────────────────────────────── */

// Declared destination per package — publishConfig.registry pins the
// registry in the manifest itself so a stray ~/.npmrc scope mapping (or a
// GitHub Packages config) can't silently redirect the publish.
for (const { pkg } of selected) {
  const reg = pkg.publishConfig?.registry;
  if (reg !== REGISTRY) {
    console.warn(
      `WARN ${pkg.name}: publishConfig.registry is ${reg ?? 'unset'} — ` +
        `expected ${REGISTRY}. A missing pin means whoever/whatever runs ` +
        `publish decides the destination.`,
    );
  }
}

// Auth posture — which credential the npm CLI will actually use. OIDC
// trusted publishing is the intended path; NODE_AUTH_TOKEN is the
// transitional fallback until every package has a stage-only trust
// relationship (`npm trust github ... --allow-stage-publish`).
console.log(
  process.env.NODE_AUTH_TOKEN
    ? 'auth: NODE_AUTH_TOKEN secret present — npm may use it where a package lacks OIDC trust'
    : 'auth: no NODE_AUTH_TOKEN — OIDC trusted publishing only (npm stage + provenance)',
);

// `--dry-run` transparency: show the actual tarball contents each package
// would ship (npm pack's own dry run), not just the command we'd run.
if (dryRun) {
  for (const { dir, pkg } of sorted) {
    try {
      const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
        cwd: dir,
        encoding: 'utf8',
        shell: process.platform === 'win32',
      });
      const [pack] = JSON.parse(out);
      const kb = (n) => (n / 1024).toFixed(1);
      console.log(
        `\n${pkg.name}@${version} — ${pack.entryCount ?? pack.files.length} files, ` +
          `${kb(pack.size)} kB tarball (${kb(pack.unpackedSize)} kB unpacked)`,
      );
      for (const f of pack.files) console.log(`  ${f.path}`);
    } catch {
      console.log(`\n${pkg.name}@${version} — npm pack --dry-run failed (files not listed)`);
    }
  }
}

/* ── Skip versions that are already out there ─────────────────────────────
 * Re-runs are the point: a partially-failed release, or a new package that
 * got a one-time bootstrap `npm publish` (staging can't create packages)
 * must not hard-fail the whole run. `npm view` answers "published";
 * `npm stage list` answers "staged, pending approval" — best-effort, since
 * its output shape isn't part of the CLI contract.
 */
const published = new Set();
for (const { pkg } of sorted) {
  const res = spawnSync('npm', ['view', `${pkg.name}@${version}`, 'version', '--registry', REGISTRY], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (res.status === 0 && res.stdout.trim() === version) published.add(pkg.name);
}
let stagedLines = [];
try {
  const out = execFileSync('npm', ['stage', 'list'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  stagedLines = out.split('\n');
} catch {
  /* no stage-queue access in this environment — the publish check still applies */
}
const stagedPending = (name) =>
  stagedLines.some((l) => l.includes(name) && l.includes(version));

const results = [];
for (const { dir, pkg } of sorted) {
  if (published.has(pkg.name)) {
    console.log(`skip ${pkg.name}@${version} — already published`);
    results.push({ name: pkg.name, status: 'skipped — already published' });
    continue;
  }
  if (stagedPending(pkg.name)) {
    console.log(`skip ${pkg.name}@${version} — already staged, pending approval`);
    results.push({ name: pkg.name, status: 'skipped — already staged' });
    continue;
  }
  // --direct: one-time bootstrap publish — staging requires an existing
  // package; --provenance is CI-only (needs Actions OIDC).
  const cmd = direct
    ? ['publish', '--access', 'public']
    : ['stage', 'publish', '--access', 'public', '--provenance'];
  console.log(`${dryRun ? '[dry-run] ' : ''}npm ${cmd.join(' ')}  ${pkg.name}@${version}`);
  if (dryRun) {
    results.push({ name: pkg.name, status: 'dry-run' });
    continue;
  }
  try {
    execFileSync('npm', cmd, { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });
    results.push({ name: pkg.name, status: direct ? 'published' : 'staged' });
  } catch {
    results.push({ name: pkg.name, status: 'FAILED' });
    throw new Error(`${pkg.name} failed — see npm output above`);
  }
}

/* ── The run's durable record ──────────────────────────────────────────────
 * GitHub renders $GITHUB_STEP_SUMMARY on the workflow run page — the
 * at-a-glance list of what this release staged, without digging through
 * npm's per-package log output. Outside Actions the same table prints to
 * stdout.
 */
const table = [
  `| package | version | result |`,
  `| --- | --- | --- |`,
  ...results.map((r) => `| \`${r.name}\` | \`${version}\` | ${r.status} |`),
].join('\n');
const summary =
  `### ${direct ? 'Published' : 'Staged'} packages — ${tag}\n\n` +
  `${table}\n\n` +
  (direct
    ? ''
    : `Staged versions are **not installable** until approved — \`npm stage list\` / \`npm stage approve <id>\` (2FA), or the Staged Packages tab on npmjs.com.\n`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
} else {
  console.log(`\n${summary}`);
}
