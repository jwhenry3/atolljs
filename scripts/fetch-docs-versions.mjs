// Downloads release-time docs snapshots into docs-versions/ for
// assemble-pages.mjs to mount under consumer/v<x.y.z>/.
//
// Each release carries a docs-v<x.y.z>.tar.gz asset (uploaded by the
// docs-snapshot job in publish.yml). This uses the `gh` CLI — preinstalled
// on Actions runners, authenticated via GH_TOKEN/GITHUB_TOKEN. Without gh
// (plain local builds) it warns and exits 0 so `serve:pages` still works.
//
// Usage: node scripts/fetch-docs-versions.mjs
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'docs-versions');

function gh(args) {
  return spawnSync('gh', args, { cwd: root, encoding: 'utf8' });
}

if (gh(['--version']).error) {
  console.warn('fetch-docs-versions: gh CLI not found — skipping snapshot download (docs-versions/ stays empty)');
  process.exit(0);
}

const repo = process.env.GITHUB_REPOSITORY ??
  /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(
    JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).repository?.url ?? ''
  )?.[1];
if (!repo) {
  console.warn('fetch-docs-versions: could not determine repo — skipping');
  process.exit(0);
}

const list = gh(['release', 'list', '--repo', repo, '--limit', '100', '--json', 'tagName', '--jq', '.[].tagName']);
if (list.status !== 0) {
  console.warn(`fetch-docs-versions: gh release list failed (${(list.stderr || '').trim()}) — skipping`);
  process.exit(0);
}
const tags = list.stdout.split('\n').filter(Boolean);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

let found = 0;
for (const tag of tags) {
  const dl = gh(['release', 'download', tag, '--repo', repo, '-p', 'docs-*.tar.gz', '-D', out, '--clobber']);
  // Releases without a docs asset fail "no assets match" — that's expected.
  if (dl.status === 0) {
    found++;
    console.log(`  ${tag}: ${dl.stdout.trim() || 'snapshot downloaded'}`);
  }
}
console.log(`fetch-docs-versions: ${found} snapshot(s) -> docs-versions/`);
