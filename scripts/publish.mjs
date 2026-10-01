// Lockstep staged publish — `node scripts/publish.mjs <version|v*.*.*> [--dry-run]`.
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
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const [, , tag, ...rest] = process.argv;
const dryRun = rest.includes('--dry-run');
const direct = rest.includes('--direct');

const version = tag?.replace(/^v/, '');
if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error(`usage: node scripts/publish.mjs <semver|vSemver> [--dry-run] — got "${tag ?? ''}"`);
  process.exit(1);
}

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
  for (const { dir, pkg } of packages) {
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

// Stamp version + rewrite internal dep ranges to the release version.
for (const { dir, pkg } of packages) {
  pkg.version = version;
  for (const field of ['dependencies', 'peerDependencies', 'devDependencies']) {
    for (const dep of Object.keys(pkg[field] ?? {})) {
      if (names.has(dep)) pkg[field][dep] = version;
    }
  }
  if (!dryRun) writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
}

// Dependency order — a package publishes after every internal dep it needs.
const order = [
  '@atolljs/core',
  '@atolljs/node',
  '@atolljs/react',
  // react-island peers on islands — publish the dep first.
  '@atolljs/islands',
  '@atolljs/react-island',
];
const sorted = [...packages].sort(
  (a, b) => (order.indexOf(a.pkg.name) === -1 ? 99 : order.indexOf(a.pkg.name)) -
            (order.indexOf(b.pkg.name) === -1 ? 99 : order.indexOf(b.pkg.name)),
);

/* ── Transparency preamble ──────────────────────────────────────────────── */

// Declared destination per package — publishConfig.registry pins the
// registry in the manifest itself so a stray ~/.npmrc scope mapping (or a
// GitHub Packages config) can't silently redirect the publish.
for (const { pkg } of packages) {
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

/* ── Stage (or publish) each package, recording the outcome ─────────────── */

const results = [];
for (const { dir, pkg } of sorted) {
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
