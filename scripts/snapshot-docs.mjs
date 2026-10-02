// Builds a versioned docs snapshot for a release tag:
//
//   node scripts/snapshot-docs.mjs v0.1.3 [--no-build]
//
// Produces docs-v0.1.3.tar.gz at the repo root — the workflow uploads it as
// a release asset; assemble-pages.mjs later mounts it at consumer/v0.1.3/.
//
// The snapshot is the FULL consumer tree (docs pages + demo mounts +
// coi-sw.js), so its iframes and service worker resolve inside v0.1/ and the
// archive is self-contained. VITE_DOCS_VERSION stamps <meta atoll:version>
// and a robots noindex into every page so snapshots never outrank latest.
//
// Env overrides are set on this process — runStep children inherit them.
// GITHUB_REPOSITORY (owner/repo) is honored when present for fork builds.
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { npmCmd, npmScript, runStep, stop } from './orchestrate.mjs';
import { CONSUMER_PROJECTS, mountConsumerTree } from './pages-lib.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

const tag = process.argv[2];
if (!/^v?\d+\.\d+\.\d+/.test(tag ?? '')) {
  console.error('usage: node scripts/snapshot-docs.mjs <tag>   e.g. v0.1.3');
  process.exit(1);
}
const ver = `v${tag.replace(/^v/, '')}`; // 0.1.3 / v0.1.3 -> v0.1.3

// owner/repo — for the Pages base path baked into links/canonicals.
const slug = (process.env.GITHUB_REPOSITORY ??
  /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(
    JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).repository?.url ?? ''
  )?.[1] ??
  'jwhenry3/atolljs'
).split('/');
const [owner, repo] = slug;

process.env.VITE_CONSUMER_BASE = `/${repo}/consumer/${ver}/`;
process.env.DOCS_BASE_URL = `https://${owner}.github.io/${repo}/consumer/${ver}/`;
process.env.VITE_DOCS_VERSION = ver;
console.log(`snapshot: ${tag} -> ${ver}  (base ${process.env.VITE_CONSUMER_BASE})`);

if (!process.argv.includes('--no-build')) {
  for (const [name, cwd] of CONSUMER_PROJECTS) {
    try {
      await runStep(`${name}:build`, cwd, npmCmd, npmScript('build'));
    } catch (error) {
      console.error(error.message);
      stop(1);
    }
  }
}

const stage = join(root, 'dist-snapshot');
rmSync(stage, { recursive: true, force: true });
mountConsumerTree(root, stage);

// tar -C stage . → archive root IS the consumer tree; extraction into
// consumer/v<minor>/ at deploy time lands the files at the right depth.
// Relative paths only — Windows bsdtar reads 'C:\…' as rmt host:path syntax.
const tarball = `docs-v${tag.replace(/^v/, '')}.tar.gz`; // normalize: always docs-v<x.y.z>
execFileSync('tar', ['czf', tarball, '-C', 'dist-snapshot', '.'], { cwd: root });
rmSync(stage, { recursive: true, force: true });
console.log(`snapshot: ${tarball} written — upload it as a release asset`);
