#!/usr/bin/env node
// Approve staged @atolljs/* versions — the counterpart to
// publish.mjs's `npm stage publish` step. Staged packages are NOT
// installable until approved; this walks the stage queue and approves
// each pending package in dependency order (core first, so dependents
// never hit the registry before their requirements).
//
//   node scripts/approve-staged.mjs                 # npm's own 2FA flow per approval
//   node scripts/approve-staged.mjs --otp=123456    # share one TOTP across approvals
//   node scripts/approve-staged.mjs --dry-run       # list the queue, approve nothing
//
// npm stage approve is a 2FA-gated write per call. A single TOTP code
// usually stays valid long enough to cover a handful of back-to-back
// approvals; if it expires mid-run, just run again — already-approved
// packages drop out of `npm stage list` so re-runs only touch what's
// still pending.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Same Windows-safe npm resolution as publish.mjs: `.cmd` shims are
// unspawnable without a shell, so run npm-cli.js through this node.
const npmCli = [
  process.env.npm_execpath,
  join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
].find((p) => p && existsSync(p));
const NPM_CMD = npmCli ? process.execPath : 'npm';
const NPM_ARGS = npmCli ? [npmCli] : [];
const npm = (args, opts = {}) =>
  spawnSync(NPM_CMD, [...NPM_ARGS, ...args], { encoding: 'utf8', ...opts });

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const otpArg = args.find((a) => a.startsWith('--otp='));
const otp = otpArg ? otpArg.split('=')[1] : null;

const SCOPE = '@atolljs/';
// Dependency order — approve requirements before dependents so the
// registry never briefly serves a version whose deps don't exist yet.
// Mirrors publish.mjs's staging order, extended to the real dep chains:
// *-island packages dep on islands+core, nestjs on core+node, nextjs on
// core+react; cli/vite/incidents carry no internal runtime deps.
const ORDER = [
  '@atolljs/core',
  '@atolljs/node',
  '@atolljs/react',
  '@atolljs/islands',
  '@atolljs/vue',
  '@atolljs/solidjs',
  '@atolljs/svelte',
  '@atolljs/angular',
  '@atolljs/react-island',
  '@atolljs/vue-island',
  '@atolljs/solid-island',
  '@atolljs/svelte-island',
  '@atolljs/angular-island',
  '@atolljs/nestjs',
  '@atolljs/nextjs',
  '@atolljs/devtools',
];

const list = npm(['stage', 'list', '--json']);
if (list.status !== 0) {
  console.error(list.stderr || 'npm stage list failed');
  process.exit(list.status ?? 1);
}
const staged = (JSON.parse(list.stdout || '[]') ?? []).filter(
  (s) => s.status === 'staged',
);
const ours = staged
  .filter((s) => s.packageName?.startsWith(SCOPE))
  .sort(
    (a, b) =>
      (ORDER.indexOf(a.packageName) === -1 ? 99 : ORDER.indexOf(a.packageName)) -
      (ORDER.indexOf(b.packageName) === -1 ? 99 : ORDER.indexOf(b.packageName)),
  );
const others = staged.filter((s) => !s.packageName?.startsWith(SCOPE));

if (ours.length === 0) {
  console.log('No staged @atolljs/* versions pending approval.');
} else {
  for (const s of ours) {
    console.log(`\n→ npm stage approve ${s.id}  ${s.packageName}@${s.version}`);
    if (dryRun) continue;
    const cmd = ['stage', 'approve', s.id];
    if (otp) cmd.push(`--otp=${otp}`);
    const r = spawnSync(NPM_CMD, [...NPM_ARGS, ...cmd], { stdio: 'inherit' });
    if (r.status !== 0) {
      console.error(`\napprove failed for ${s.packageName}@${s.version} — re-run to continue`);
      process.exit(r.status ?? 1);
    }
  }
}
if (others.length) {
  console.log(
    `\n(skipped ${others.length} non-${SCOPE} staged item(s): ` +
      others.map((s) => `${s.packageName}@${s.version}`).join(', ') +
      ')',
  );
}
if (!dryRun && ours.length) console.log('\nDone.');
