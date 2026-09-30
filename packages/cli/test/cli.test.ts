import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.ts';
import { scriptIo, type Io } from '../src/io.ts';
import { detectFramework, detectProject } from '../src/project.ts';
import { parseArgs } from '../src/parse.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'atoll-cli-'));

const run = (argv: string[], cwd: string, answers: (string | boolean)[] = []) =>
  runCli(argv, scriptIo(answers), cwd);

const writePkg = (dir: string, pkg: object) =>
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));

describe('parseArgs', () => {
  it('splits positionals, long flags, and shorts', () => {
    const a = parseArgs(['add', 'worker', 'my-pool', '--dir', 'src/x', '--force', '-y']);
    expect(a._).toEqual(['add', 'worker', 'my-pool']);
    expect(a.flags.dir).toBe('src/x');
    expect(a.flags.force).toBe(true);
    expect(a.flags.y).toBe(true);
  });
});

describe('detectFramework', () => {
  it('orders host frameworks before generic ones', () => {
    expect(detectFramework({ dependencies: { next: '15', react: '19' } })).toBe('nextjs');
    expect(detectFramework({ dependencies: { '@nestjs/core': '11', express: '5' } })).toBe('nestjs');
    expect(detectFramework({ dependencies: { express: '5' } })).toBe('node');
    expect(detectFramework({ dependencies: { react: '19' } })).toBe('react');
    expect(detectFramework({ dependencies: { 'solid-js': '1' } })).toBe('solid');
    expect(detectFramework({})).toBe('vanilla');
  });
});

describe('atoll init', () => {
  it('writes .npmrc + the contract/worker/client spine into src/atoll', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'src'));
    writePkg(dir, { name: 'demo', dependencies: { react: '^19' } });
    const code = await run(['init'], dir, [false]); // decline install
    expect(code).toBe(0);
    const npmrc = readFileSync(join(dir, '.npmrc'), 'utf8');
    expect(npmrc).toContain('min-release-age=7');
    expect(npmrc).toContain('ignore-scripts=true');
    const worker = readFileSync(join(dir, 'src/atoll/app.worker.ts'), 'utf8');
    expect(worker).toContain('defineWorker');
    expect(worker).toContain('sharedMemory: appMemory');
    const client = readFileSync(join(dir, 'src/atoll/app.ts'), 'utf8');
    expect(client).toContain('connectWorker');
    expect(client).toContain(`new URL('./app.worker.ts', import.meta.url)`);
  });

  it('emits the node host variant for server projects', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'src'));
    writePkg(dir, { name: 'api', dependencies: { express: '^5' } });
    const code = await run(['init'], dir, [false]);
    expect(code).toBe(0);
    const worker = readFileSync(join(dir, 'src/atoll/app.worker.ts'), 'utf8');
    expect(worker).toContain(`import '@atolljs/node/shim';`);
    const client = readFileSync(join(dir, 'src/atoll/app.ts'), 'utf8');
    expect(client).toContain('createNodePool');
    expect(client).toContain('node:worker_threads');
  });

  it('fails outside a project', async () => {
    const dir = tmp();
    const io = scriptIo();
    const code = await runCli(['init'], io, dir);
    expect(code).toBe(1);
    expect(io.output.join('\n')).toContain('no package.json');
  });
});

describe('atoll add', () => {
  it('add worker co-locates a same-named memory contract', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'src/atoll'), { recursive: true });
    writePkg(dir, { name: 'demo', dependencies: { react: '^19' } });
    writeFileSync(join(dir, 'src/atoll/reports.memory.ts'), 'export const reportsMemory = 1;');
    const code = await run(['add', 'worker', 'reports'], dir);
    expect(code).toBe(0);
    const client = readFileSync(join(dir, 'src/atoll/reports.ts'), 'utf8');
    expect(client).toContain(`import { reportsMemory } from './reports.memory';`);
    expect(client).toContain('sharedMemory: reportsMemory');
  });

  it('add memory writes a defineSharedMemory contract', async () => {
    const dir = tmp();
    writePkg(dir, { name: 'demo' });
    const code = await run(['add', 'memory', 'metrics'], dir);
    expect(code).toBe(0);
    const file = join(dir, 'src/atoll/metrics.memory.ts');
    // no src dir → falls back to root
    const alt = join(dir, 'atoll/metrics.memory.ts');
    const content = readFileSync(existsSync(file) ? file : alt, 'utf8');
    expect(content).toContain('defineSharedMemory');
    expect(content).toContain('mz.object');
  });

  it('add island emits a react worker entry and prints shell usage', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'src'));
    writePkg(dir, { name: 'demo', dependencies: { react: '^19' } });
    const io = scriptIo(['mono']); // pick the mono variant
    const code = await runCli(['add', 'island', 'charts'], io, dir);
    expect(code).toBe(0);
    const worker = readFileSync(join(dir, 'src/islands/charts.worker.tsx'), 'utf8');
    expect(worker).toContain('defineReactMonoWorker');
    expect(io.output.join('\n')).toContain(`new URL('./islands/charts.worker.tsx'`);
  });

  it('add island facade emits app + poly worker + contract (framework positional)', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'src'));
    writePkg(dir, { name: 'demo', dependencies: { react: '^19' } });
    // atoll add react island facade counter — the grammar from the spec
    const io = scriptIo();
    const code = await runCli(['add', 'react', 'island', 'facade', 'counter'], io, dir);
    expect(code).toBe(0);
    const app = readFileSync(join(dir, 'src/islands/counter.app.tsx'), 'utf8');
    expect(app).toContain(`islandApp('counter'`);
    const worker = readFileSync(join(dir, 'src/islands/counter.worker.tsx'), 'utf8');
    expect(worker).toContain('defineReactPolyWorker');
    const contract = readFileSync(join(dir, 'src/islands/counter.island.ts'), 'utf8');
    expect(contract).toContain('export const worker');
    expect(contract).toContain(`export { CounterApp as app }`);
    expect(io.output.join('\n')).toContain('lazyIsland');
  });

  it('add island facade prompts for the variant when omitted', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'src'));
    writePkg(dir, { name: 'demo', dependencies: { react: '^19' } });
    const io = scriptIo(); // no answers → select resolves to the default 'facade'
    const code = await runCli(['add', 'island', 'charts'], io, dir);
    expect(code).toBe(0);
    expect(existsSync(join(dir, 'src/islands/charts.island.ts'))).toBe(true);
    const worker = readFileSync(join(dir, 'src/islands/charts.worker.tsx'), 'utf8');
    expect(worker).toContain('defineReactPolyWorker');
  });

  it('add island refuses non-island frameworks', async () => {
    const dir = tmp();
    writePkg(dir, { name: 'api', dependencies: { express: '^5' } });
    const code = await run(['add', 'island', 'charts'], dir);
    expect(code).toBe(1);
  });

  it('never clobbers without --force', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'src/atoll'), { recursive: true });
    writePkg(dir, { name: 'demo' });
    const existing = join(dir, 'src/atoll/x.memory.ts');
    writeFileSync(existing, 'ORIGINAL');
    const io = scriptIo([false]); // decline overwrite prompt
    const code = await runCli(['add', 'memory', 'x'], io, dir);
    expect(code).toBe(0);
    expect(readFileSync(existing, 'utf8')).toBe('ORIGINAL');
    await runCli(['add', 'memory', 'x', '--force'], scriptIo(), dir);
    expect(readFileSync(existing, 'utf8')).toContain('defineSharedMemory');
  });
});

describe('atoll new', () => {
  it('scaffolds a react vite app with an island + headers', async () => {
    const dir = tmp();
    const code = await run(['new', 'my-app', '--framework', 'react'], dir, [false]);
    expect(code).toBe(0);
    const pkg = JSON.parse(readFileSync(join(dir, 'my-app/package.json'), 'utf8'));
    expect(pkg.dependencies['@atolljs/react-island']).toBeDefined();
    const vite = readFileSync(join(dir, 'my-app/vite.config.ts'), 'utf8');
    expect(vite).toContain('Cross-Origin-Embedder-Policy');
    expect(existsSync(join(dir, 'my-app/src/islands/counter.worker.tsx'))).toBe(true);
    expect(readFileSync(join(dir, 'my-app/.npmrc'), 'utf8')).toContain('ignore-scripts');
  });

  it('scaffolds a node service with a bundled-worker pool', async () => {
    const dir = tmp();
    const code = await run(['new', 'svc', '--framework', 'node'], dir, [false]);
    expect(code).toBe(0);
    const pkg = JSON.parse(readFileSync(join(dir, 'svc/package.json'), 'utf8'));
    expect(pkg.scripts.bundle).toContain('esbuild');
    const worker = readFileSync(join(dir, 'svc/src/atoll/tasks.worker.ts'), 'utf8');
    expect(worker).toContain(`@atolljs/node/shim`);
    const pool = readFileSync(join(dir, 'svc/src/atoll/tasks.ts'), 'utf8');
    expect(pool).toContain(`new URL('../../dist/tasks.worker.js'`);
  });

  it('rejects an existing non-empty dir', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'taken'));
    writeFileSync(join(dir, 'taken/file.txt'), 'x');
    expect(await run(['new', 'taken', '--framework', 'react'], dir)).toBe(1);
  });

  it.each(['vue', 'solid', 'svelte'] as const)('scaffolds a %s app', async (fw) => {
    const dir = tmp();
    const code = await run(['new', `${fw}-app`, '--framework', fw], dir, [false]);
    expect(code).toBe(0);
    const pkg = JSON.parse(readFileSync(join(dir, `${fw}-app/package.json`), 'utf8'));
    expect(Object.keys(pkg.dependencies).some((d) => d.startsWith('@atolljs/'))).toBe(true);
    expect(existsSync(join(dir, `${fw}-app/index.html`))).toBe(true);
    expect(readFileSync(join(dir, `${fw}-app/vite.config.ts`), 'utf8')).toContain('Cross-Origin-Opener-Policy');
  });

  it('prompts for the framework when --framework is absent', async () => {
    const dir = tmp();
    const code = await run(['new', 'picked'], dir, ['vue', false]); // select vue, decline install
    expect(code).toBe(0);
    expect(existsSync(join(dir, 'picked/src/App.vue'))).toBe(true);
  });

  it('refuses angular with a pointer to ng new', async () => {
    const dir = tmp();
    const io = scriptIo();
    expect(await runCli(['new', 'ng-app', '--framework', 'angular'], io, dir)).toBe(1);
    expect(io.output.join('\n')).toContain('ng new');
  });
});

describe('atoll doctor', () => {
  it('warns on missing .npmrc and passes a configured project', async () => {
    const dir = tmp();
    writePkg(dir, { name: 'demo', dependencies: { '@atolljs/core': '0.1.0' } });
    const io = scriptIo();
    await runCli(['doctor'], io, dir);
    expect(io.output.join('\n')).toContain('.npmrc');
    // --fix writes it
    await runCli(['doctor', '--fix'], io, dir);
    expect(readFileSync(join(dir, '.npmrc'), 'utf8')).toContain('min-release-age=7');
  });

  it('passes cleanly on a well-formed project', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'src'));
    writePkg(dir, {
      name: 'demo',
      dependencies: { '@atolljs/core': '0.1.0', vue: '^3' },
    });
    writeFileSync(join(dir, '.npmrc'), 'min-release-age=7\n');
    writeFileSync(join(dir, 'package-lock.json'), '{}');
    writeFileSync(
      join(dir, 'vite.config.ts'),
      `headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }`,
    );
    writeFileSync(join(dir, 'src/ok.ts'), `const w = new Worker(new URL('./x.ts', import.meta.url));`);
    const io = scriptIo();
    expect(await runCli(['doctor'], io, dir)).toBe(0);
  });

  it('flags new Worker() calls bundlers cannot see', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'src'));
    writePkg(dir, { name: 'demo', dependencies: { '@atolljs/core': '0.1.0' } });
    writeFileSync(join(dir, 'src/bad.ts'), `const w = new Worker('./x.js');`);
    const io = scriptIo();
    const code = await runCli(['doctor'], io, dir);
    expect(code).toBe(1);
    expect(io.output.join('\n')).toContain('bundlers');
  });
});

describe('island templates', () => {
  it.each([
    ['vue', 'islands/Charts.vue', 'islands/charts.worker.ts', 'defineVueMonoWorker'],
    ['solid', 'islands/charts.worker.tsx', null, 'defineSolidMonoWorker'],
    ['svelte', 'islands/Charts.svelte', 'islands/charts.worker.ts', 'defineSvelteMonoWorker'],
    ['angular', 'islands/charts.worker.ts', null, 'angularIslandApp'],
  ] as const)('%s emits the right files and worker fn', async (fw, a, b, needle) => {
    const dir = tmp();
    mkdirSync(join(dir, 'src'));
    writePkg(dir, { name: 'demo' });
    const code = await run(['add', 'island', 'mono', 'charts', '--framework', fw], dir);
    expect(code).toBe(0);
    expect(existsSync(join(dir, `src/${a}`))).toBe(true);
    if (b) expect(existsSync(join(dir, `src/${b}`))).toBe(true);
    const worker = readFileSync(join(dir, `src/${b ?? a}`), 'utf8');
    expect(worker).toContain(needle);
  });
});

describe('nestjs add kinds', () => {
  const nestPkg = (dir: string) =>
    writePkg(dir, { name: 'api', dependencies: { '@nestjs/core': '11' } });

  it('service emits the @AtollService facade + pool module + worker entry', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'src/atoll'), { recursive: true });
    nestPkg(dir);
    const code = await run(['add', 'nestjs', 'service', 'reports'], dir);
    expect(code).toBe(0);
    const svc = readFileSync(join(dir, 'src/atoll/reports.service.ts'), 'utf8');
    expect(svc).toContain(`@AtollService({ pool: 'reports' })`);
    const mod = readFileSync(join(dir, 'src/atoll/reports.module.ts'), 'utf8');
    expect(mod).toContain(`AtollModule.registerPool`);
    expect(mod).toContain(`name: 'reports'`);
    const worker = readFileSync(join(dir, 'src/atoll/reports.worker.ts'), 'utf8');
    expect(worker).toContain('runAtollWorker(ReportsModule)');
  });

  it('method emits @AtollTask offload only', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'src/atoll'), { recursive: true });
    nestPkg(dir);
    const code = await run(['add', 'nestjs', 'method', 'digest'], dir);
    expect(code).toBe(0);
    const svc = readFileSync(join(dir, 'src/atoll/digest.service.ts'), 'utf8');
    expect(svc).toContain(`@AtollTask({ pool: 'digest' })`);
    expect(svc).not.toContain('AtollService');
  });

  it('module emits the registerPool boundary + worker entry', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'src/atoll'), { recursive: true });
    nestPkg(dir);
    const code = await run(['add', 'module', 'jobs'], dir); // detected nestjs
    expect(code).toBe(0);
    const mod = readFileSync(join(dir, 'src/atoll/jobs.module.ts'), 'utf8');
    expect(mod).toContain(`AtollModule.registerPool`);
    expect(existsSync(join(dir, 'src/atoll/jobs.worker.ts'))).toBe(true);
  });

  it('housed emits the api module, controller, worker, and pool module + wiring', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'src/atoll'), { recursive: true });
    nestPkg(dir);
    const io = scriptIo();
    const code = await runCli(['add', 'housed', 'reports'], io, dir);
    expect(code).toBe(0);
    const worker = readFileSync(join(dir, 'src/atoll/reports.worker.ts'), 'utf8');
    expect(worker).toContain('serveHttp');
    const ctrl = readFileSync(join(dir, 'src/atoll/reports.controller.ts'), 'utf8');
    expect(ctrl).toContain(`@Controller('api/reports')`);
    expect(existsSync(join(dir, 'src/atoll/reports-api.module.ts'))).toBe(true);
    expect(existsSync(join(dir, 'src/atoll/reports-atoll.module.ts'))).toBe(true);
    expect(io.output.join('\n')).toContain('proxyToWorker');
  });

  it('rejects nestjs kinds on a non-nestjs project', async () => {
    const dir = tmp();
    writePkg(dir, { name: 'demo', dependencies: { react: '^19' } });
    const code = await run(['add', 'service', 'x'], dir);
    expect(code).toBe(1);
  });
});

describe('nextjs add kinds', () => {
  const nextPkg = (dir: string) =>
    writePkg(dir, { name: 'web', dependencies: { next: '15', react: '19' } });

  it('route task emits contract + registry worker + pool + handler', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'src'), { recursive: true });
    nextPkg(dir);
    const code = await run(['add', 'nextjs', 'route', 'task', 'digest'], dir);
    expect(code).toBe(0);
    const worker = readFileSync(join(dir, 'src/app/api/digest/digest.worker.ts'), 'utf8');
    expect(worker).toContain('TaskRegistry.register');
    expect(worker).toContain(`import '@atolljs/node/shim'`);
    const pool = readFileSync(join(dir, 'src/app/api/digest/pool.ts'), 'utf8');
    expect(pool).toContain('createNodePool');
    expect(pool).toContain('getDigest');
    const route = readFileSync(join(dir, 'src/app/api/digest/route.ts'), 'utf8');
    expect(route).toContain(`runtime = 'nodejs'`);
    expect(route).toContain('pool.run');
  });

  it('route client emits defineWorker + typed workerClient', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'src'), { recursive: true });
    nextPkg(dir);
    const code = await run(['add', 'route', 'client', 'jobs'], dir); // detected nextjs
    expect(code).toBe(0);
    const worker = readFileSync(join(dir, 'src/app/api/jobs/jobs.worker.ts'), 'utf8');
    expect(worker).toContain('defineWorker');
    const pool = readFileSync(join(dir, 'src/app/api/jobs/pool.ts'), 'utf8');
    expect(pool).toContain('workerClient<JobsWorker>');
    const contract = readFileSync(join(dir, 'src/app/api/jobs/jobs.contract.ts'), 'utf8');
    expect(contract).toContain('defineSharedMemory');
  });

  it('component emits a use-client component over the pool client', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'src/atoll'), { recursive: true });
    nextPkg(dir);
    const code = await run(['add', 'component', 'panel'], dir);
    expect(code).toBe(0);
    const comp = readFileSync(join(dir, 'src/atoll/panel.tsx'), 'utf8');
    expect(comp).toContain(`'use client'`);
    expect(comp).toContain(`useTask(panel.echo)`);
  });

  it('instrumentation emits the register() warmup hook', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'src'), { recursive: true });
    nextPkg(dir);
    const code = await run(['add', 'instrumentation', 'digest'], dir);
    expect(code).toBe(0);
    const inst = readFileSync(join(dir, 'src/instrumentation.ts'), 'utf8');
    expect(inst).toContain('NEXT_RUNTIME');
    expect(inst).toContain(`import('./app/api/digest/pool')`);
  });

  it('add nextjs worker emits browser pool + client component bindings', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'src/atoll'), { recursive: true });
    nextPkg(dir);
    const code = await run(['add', 'nextjs', 'worker', 'panel'], dir);
    expect(code).toBe(0);
    const client = readFileSync(join(dir, 'src/atoll/panel.ts'), 'utf8');
    expect(client).toContain('connectWorker');
    const comp = readFileSync(join(dir, 'src/atoll/panel.tsx'), 'utf8');
    expect(comp).toContain(`'use client'`);
    expect(comp).toContain('@atolljs/nextjs');
  });
});

describe('misc', () => {
  it('unknown command exits 1 and prints help', async () => {
    const io = scriptIo();
    expect(await runCli(['frobnicate'], io, tmp())).toBe(1);
    expect(io.output.join('\n')).toContain('atoll new');
  });

  it('no command prints help', async () => {
    const io = scriptIo();
    expect(await runCli([], io, tmp())).toBe(0);
  });

  it('invalid names are rejected', async () => {
    const dir = tmp();
    writePkg(dir, { name: 'demo' });
    expect(await run(['add', 'worker', 'Bad Name!!'], dir)).toBe(1);
  });

  it('doctor on a node project skips the header check', async () => {
    const dir = tmp();
    writePkg(dir, { name: 'api', dependencies: { express: '^5', '@atolljs/node': '0.1.0' } });
    const io = scriptIo();
    await runCli(['doctor'], io, dir);
    expect(io.output.join('\n')).toContain('n/a — node runtime');
  });
});

describe('detectProject', () => {
  it('finds the nearest package.json walking up', () => {
    const dir = tmp();
    writePkg(dir, { name: 'demo' });
    const deep = join(dir, 'a/b/c');
    mkdirSync(deep, { recursive: true });
    expect(detectProject(deep).root).toBe(dir);
  });
});
