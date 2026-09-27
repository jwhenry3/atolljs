// Lockstep publish — `node scripts/publish.mjs <version|v*.*.*> [--dry-run]`.
//
// Stamps every publishable package.json (repo root = @jwhenry123/mesh, plus
// packages/* — private packages are skipped) with the release version,
// rewrites internal @jwhenry123/* dep ranges to match, then `npm publish`es
// in dependency order: mesh → node/react → the rest. CI runs this from a
// release tag; repo versions stay 0.0.0 as a "not yet released" marker.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const [, , tag, ...rest] = process.argv;
const dryRun = rest.includes('--dry-run');

const version = tag?.replace(/^v/, '');
if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error(`usage: node scripts/publish.mjs <semver|vSemver> [--dry-run] — got "${tag ?? ''}"`);
  process.exit(1);
}

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
const order = ['@jwhenry123/mesh', '@jwhenry123/mesh-node', '@jwhenry123/mesh-react'];
const sorted = [...packages].sort(
  (a, b) => (order.indexOf(a.pkg.name) === -1 ? 99 : order.indexOf(a.pkg.name)) -
            (order.indexOf(b.pkg.name) === -1 ? 99 : order.indexOf(b.pkg.name)),
);

for (const { dir, pkg } of sorted) {
  const cmd = ['publish', '--access', 'public', '--provenance'];
  console.log(`${dryRun ? '[dry-run] ' : ''}npm ${cmd.join(' ')}  ${pkg.name}@${version}`);
  if (!dryRun) execFileSync('npm', cmd, { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });
}
