import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsTree } from 'nx/src/generators/tree';
import { describe, expect, it } from 'vitest';
import type { ExecutorContext } from '@nx/devkit';
import { resolveCliEntry, runAtoll } from '../src/atoll';
import { doctorExecutor } from '../src/executors';
import { initGenerator, islandGenerator, workerGenerator } from '../src/generators';

const tmp = () => mkdtempSync(join(tmpdir(), 'atoll-nx-'));

/** A minimal Nx workspace: root manifests + one app project at apps/web. */
function nxWorkspace() {
  const root = tmp();
  writeFileSync(join(root, 'nx.json'), '{}');
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'ws', dependencies: { react: '^19' } }),
  );
  mkdirSync(join(root, 'apps/web'), { recursive: true });
  writeFileSync(
    join(root, 'apps/web/project.json'),
    JSON.stringify({
      name: 'web',
      root: 'apps/web',
      sourceRoot: 'apps/web/src',
      projectType: 'application',
      targets: {},
    }),
  );
  return { root, tree: new FsTree(root, false) };
}

describe('resolveCliEntry', () => {
  it('finds the repo cli build (or sources)', () => {
    const entry = resolveCliEntry();
    expect(existsSync(entry)).toBe(true);
    expect(entry).toMatch(/cli\.(js|ts)$/);
  });
});

describe('runAtoll', () => {
  it('drives `atoll add` in a plain project dir', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo' }));
    // --yes: piped stdin is non-interactive anyway, but keep it explicit so
    // a TTY-local vitest run can't block on the CLI's own prompts.
    expect(runAtoll(['add', 'memory', 'meters', '--yes'], dir)).toBe(0);
    expect(existsSync(join(dir, 'src/atoll/meters.memory.ts'))).toBe(true);
  });
});

describe('generators', () => {
  it('init --project scopes the spine to the project sourceRoot', async () => {
    const { root, tree } = nxWorkspace();
    await initGenerator(tree, { project: 'web', name: 'core', install: false });
    expect(existsSync(join(root, 'apps/web/src/atoll/core.memory.ts'))).toBe(true);
    expect(existsSync(join(root, 'apps/web/src/atoll/core.worker.ts'))).toBe(true);
    expect(existsSync(join(root, 'apps/web/src/atoll/core.ts'))).toBe(true);
    // .npmrc + install target still land at the detected package root.
    expect(readFileSync(join(root, '.npmrc'), 'utf8')).toContain('min-release-age=7');
    expect(existsSync(join(root, 'src/atoll'))).toBe(false);
  });

  it('worker targets <sourceRoot>/atoll', async () => {
    const { root, tree } = nxWorkspace();
    await workerGenerator(tree, { project: 'web', name: 'jobs', install: false });
    expect(existsSync(join(root, 'apps/web/src/atoll/jobs.worker.ts'))).toBe(true);
    expect(existsSync(join(root, 'apps/web/src/atoll/jobs.ts'))).toBe(true);
  });

  it('island targets <sourceRoot>/islands and honors --variant', async () => {
    const { root, tree } = nxWorkspace();
    await islandGenerator(tree, {
      project: 'web',
      name: 'charts',
      variant: 'mono',
      install: false,
    });
    expect(existsSync(join(root, 'apps/web/src/islands/charts.worker.tsx'))).toBe(true);
  });

  it('honors NX_DRY_RUN — reports instead of writing', async () => {
    const { root, tree } = nxWorkspace();
    process.env.NX_DRY_RUN = 'true';
    try {
      await workerGenerator(tree, { project: 'web', name: 'dry-run' });
    } finally {
      delete process.env.NX_DRY_RUN;
    }
    expect(existsSync(join(root, 'apps/web/src/atoll/dry-run.worker.ts'))).toBe(false);
  });

  it('propagates a CLI failure as a thrown error', async () => {
    const { tree } = nxWorkspace();
    // island on a node project → the CLI exits 1, the generator must throw
    await expect(
      islandGenerator(tree, {
        project: 'web',
        name: 'bad',
        framework: 'node',
        install: false,
      }),
    ).rejects.toThrow('atoll add island failed');
  });
});

describe('executors', () => {
  it('doctor reports success and honors fix', async () => {
    const dir = tmp();
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'demo', dependencies: { '@atolljs/core': '0.1.0' } }),
    );
    const res = await doctorExecutor({ fix: true }, { root: dir } as ExecutorContext);
    expect(res.success).toBe(true);
    expect(readFileSync(join(dir, '.npmrc'), 'utf8')).toContain('min-release-age=7');
  });
});
