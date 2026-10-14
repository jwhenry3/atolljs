import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The published artifact is a CJS bundle (dist/index.cjs) because Nx's plugin
// loader uses require(); in-repo vitest runs the same sources as ESM. Pick
// whichever of __dirname / import.meta exists — both resolve to a dir two
// levels below packages/ either way (src/ or dist/).
const here =
  typeof __dirname === 'string' ? __dirname : dirname(fileURLToPath(import.meta.url));

/**
 * Locate the runnable atoll CLI entry.
 *
 * In a consumer workspace @atolljs/cli is a peer dependency — package.json is
 * on its exports map, so the bundled bin path derives from the package root.
 * This monorepo never npm-installs its own packages, so dev/tests fall back
 * to the sibling packages/cli build, then to its type-stripped sources
 * (node >= 22.18).
 */
export function resolveCliEntry(): string {
  try {
    const req = createRequire(
      typeof __dirname === 'string' ? join(__dirname, 'index.cjs') : import.meta.url,
    );
    const pkgJson = req.resolve('@atolljs/cli/package.json');
    const entry = join(dirname(pkgJson), 'dist', 'cli.js');
    if (existsSync(entry)) return entry;
  } catch {
    /* @atolljs/cli not installed from here — fall through to the repo layout */
  }
  for (const leaf of ['cli/dist/cli.js', 'cli/src/cli.ts']) {
    const p = join(here, '..', '..', leaf);
    if (existsSync(p)) return p;
  }
  throw new Error('could not locate the atoll CLI — install @atolljs/cli');
}

/** Run the atoll bin synchronously under `cwd`, stdio inherited. */
export function runAtoll(argv: readonly string[], cwd: string): number {
  const r = spawnSync(process.execPath, [resolveCliEntry(), ...argv], {
    cwd,
    stdio: 'inherit',
  });
  return r.status ?? 1;
}

/** Async variant — long-running commands (the devtools server). */
export function runAtollAsync(argv: readonly string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [resolveCliEntry(), ...argv], {
      cwd,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code !== null) resolve(code);
      // Killed by a signal — Ctrl+C on a serving executor isn't a failure.
      else resolve(signal === 'SIGINT' || signal === 'SIGTERM' ? 0 : 1);
    });
  });
}
