// `devtools.build`: a real `vite build` emits the dashboard at
// <outDir>/__atoll/ with the broadcast flag as an external script, by default
// whenever the app bundles @atolljs/devtools.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { build } from 'vite';
import { atoll, type AtollViteOptions } from '../src/index.ts';

const devtoolsSrc = fileURLToPath(new URL('../../devtools/src/index.ts', import.meta.url)).replace(/\\/g, '/');
const dirs: string[] = [];

const WITH_DEVTOOLS = `import { initDevtools } from '@atolljs/devtools';
initDevtools({ session: { name: 'build-test' } });
document.body.textContent = 'app';`;
const PLAIN = `document.body.textContent = 'app';`;

async function buildFixture(
  main: string,
  devtools?: AtollViteOptions['devtools'],
  { alias = true, ssr = false, onWarn }: { alias?: boolean; ssr?: boolean; onWarn?: (msg: string) => void } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'atoll-vite-build-'));
  dirs.push(root);
  writeFileSync(join(root, 'index.html'), '<!doctype html><html><head></head><body><script type="module" src="./main.js"></script></body></html>');
  writeFileSync(join(root, 'main.js'), main);
  await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [atoll({ devtools })],
    resolve: { alias: alias ? [{ find: /^@atolljs\/devtools$/, replacement: devtoolsSrc }] : [] },
    build: {
      outDir: join(root, 'dist'),
      ...(ssr ? { ssr: join(root, 'main.js') } : {}),
      rollupOptions: { onwarn: (w) => onWarn?.(w.message) },
    },
  });
  return join(root, 'dist');
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('devtools.build', () => {
  it('auto (default): emits the flagged dashboard when the app bundles devtools', async () => {
    const out = await buildFixture(WITH_DEVTOOLS);
    const html = readFileSync(join(out, '__atoll/index.html'), 'utf8');
    expect(html).toContain('<script src="./atoll-transport.js"></script></head>');
    expect(html.indexOf('atoll-transport.js')).toBeLessThan(html.indexOf('main.js'));
    expect(readFileSync(join(out, '__atoll/atoll-transport.js'), 'utf8')).toContain('__ATOLL_TRANSPORT = "broadcast"');
    expect(existsSync(join(out, '__atoll/main.js'))).toBe(true);
    expect(existsSync(join(out, '__atoll/panels/shell.js'))).toBe(true);
    expect(existsSync(join(out, '__atoll/panels/route.d.ts'))).toBe(false);
    expect(existsSync(join(out, 'index.html'))).toBe(true);
  });

  it('auto: skips apps that never import devtools', async () => {
    const out = await buildFixture(PLAIN);
    expect(existsSync(join(out, '__atoll'))).toBe(false);
  });

  it('true: emits even without a devtools import, honoring dir', async () => {
    const out = await buildFixture(PLAIN, { build: true, dir: 'debug/devtools' });
    expect(existsSync(join(out, 'debug/devtools/index.html'))).toBe(true);
    expect(existsSync(join(out, '__atoll'))).toBe(false);
  });

  it('skips SSR builds', async () => {
    const out = await buildFixture(PLAIN, { build: true }, { ssr: true });
    expect(existsSync(join(out, '__atoll'))).toBe(false);
  });

  it('true: warns when @atolljs/devtools cannot be resolved', async () => {
    const warnings: string[] = [];
    const out = await buildFixture(PLAIN, { build: true }, { alias: false, onWarn: (m) => warnings.push(m) });
    expect(existsSync(join(out, '__atoll'))).toBe(false);
    expect(warnings.some((w) => w.includes('@atolljs/devtools not found'))).toBe(true);
  });

  it('auto: stays silent when @atolljs/devtools is not installed', async () => {
    const warnings: string[] = [];
    const out = await buildFixture(PLAIN, undefined, { alias: false, onWarn: (m) => warnings.push(m) });
    expect(existsSync(join(out, '__atoll'))).toBe(false);
    expect(warnings.some((w) => w.includes('@atolljs/devtools'))).toBe(false);
  });

  it('false: opts out even when devtools is bundled', async () => {
    const out = await buildFixture(WITH_DEVTOOLS, { build: false });
    expect(existsSync(join(out, '__atoll'))).toBe(false);
  });
});
