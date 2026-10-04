import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Io } from './io.ts';
import { camel, flag, hasFlag, pascal, validName, type ParsedArgs } from './parse.ts';
import {
  ATOLL_DEPS,
  ISLAND_FRAMEWORKS,
  detectProject,
  missingDeps,
  pmInstallCmd,
  type Framework,
  type Pm,
  type ProjectInfo,
} from './project.ts';
import { writeTree, type OutFile } from './files.ts';
import * as T from './templates.ts';

export interface Ctx {
  io: Io;
  cwd: string;
  args: ParsedArgs;
}

const NODE_HOSTS: readonly Framework[] = ['node', 'nestjs'];
const hostOf = (fw: Framework): 'browser' | 'node' =>
  NODE_HOSTS.includes(fw) ? 'node' : 'browser';

/**
 * Install into the detected package manager, honoring the user's answer.
 * The just-written .npmrc carries min-release-age=7 — which also blocks
 * brand-new releases of the packages being installed — so the one-time
 * bootstrap runs with an explicit --min-release-age=0 override and says
 * so. The policy still governs every install after this one.
 */
async function offerInstall(
  ctx: Ctx,
  project: ProjectInfo,
  pkgs: readonly string[],
  installAll = false,
): Promise<void> {
  if (hasFlag(ctx.args, 'no-install')) {
    ctx.io.warn('--no-install — skipping dependency install');
    return;
  }
  const missing = missingDeps(project.pkg, pkgs);
  if (missing.length === 0 && !installAll) return;
  const cmd = pmInstallCmd(project.pm, installAll ? [] : missing);
  const yes = await ctx.io.confirm(`install dependencies? (${ctx.io.fmt.accent(cmd)})`, true);
  if (!yes) {
    ctx.io.warn(`skipped — run ${ctx.io.fmt.accent(cmd)} when ready`);
    return;
  }
  ctx.io.print(
    ctx.io.fmt.dim(
      'note: bootstrap install runs with --min-release-age=0 — the new .npmrc policy applies from the next install on',
    ),
  );
  const [bin, ...rest] = cmd.split(' ').filter(Boolean);
  const r = spawnSync(bin, [...rest, '--min-release-age=0'], {
    cwd: project.root ?? ctx.cwd,
    stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error(`install failed — run \`${cmd}\` manually`);
}

/* ── atoll init ─────────────────────────────────────────────────────────── */

export async function runInit(ctx: Ctx): Promise<number> {
  const project = detectProject(ctx.cwd);
  if (!project.root || !project.pkg) {
    ctx.io.error('no package.json found — run `atoll new <dir>` to scaffold, or cd into a project');
    return 1;
  }
  const rel = (abs: string) => relative(ctx.cwd, abs).replaceAll('\\', '/');
  ctx.io.print(
    ctx.io.fmt.dim(
      `detected: ${project.framework} · ${project.pm} · root ${project.root}`,
    ),
  );

  // Supply-chain baseline — the same .npmrc this repo ships.
  await writeTree(ctx.io, ctx.cwd, [{ path: rel(join(project.root, '.npmrc')), content: T.NPMRC }], {
    force: hasFlag(ctx.args, 'force'),
  });

  await offerInstall(ctx, project, ATOLL_DEPS[project.framework]);

  // A working spine: contract + worker + client, already wired together.
  const atollDir = join(project.srcDir, 'atoll');
  const host = hostOf(project.framework);
  const name = flag(ctx.args, 'name') ?? 'app';
  const files: OutFile[] = [
    { path: `${rel(atollDir)}/${name}.memory.ts`, content: T.memoryContract(name) },
    {
      path: `${rel(atollDir)}/${name}.worker.ts`,
      content: T.workerEntry(name, {
        host,
        memoryImport: `./${name}.memory`,
        memoryName: `${camel(name)}Memory`,
        demoMemoryWrite: true,
      }),
    },
    {
      path: `${rel(atollDir)}/${name}.ts`,
      content: T.workerClientFile(name, {
        host,
        memoryImport: `./${name}.memory`,
        memoryName: `${camel(name)}Memory`,
        // src/atoll/x.ts → <root>/dist/x.worker.js
        distUrl: `${relative(atollDir, join(project.root, 'dist')).replaceAll('\\', '/')}/${name}.worker.js`,
      }),
    },
  ];
  await writeTree(ctx.io, ctx.cwd, files, { force: hasFlag(ctx.args, 'force') });

  ctx.io.print('');
  ctx.io.print(ctx.io.fmt.strong('next steps:'));
  if (host === 'node') {
    ctx.io.print(
      `  bundle the worker entry (see the comment in ${name}.ts), then call ${ctx.io.fmt.accent(`${camel(name)}.echo('hi')`)}`,
    );
  } else {
    ctx.io.print(
      `  call ${ctx.io.fmt.accent(`${camel(name)}.echo('hi')`)} — the pool spawns lazily on first call`,
    );
  }
  ctx.io.print(
    `  ${ctx.io.fmt.accent('atoll add worker|memory|island <name>')} grows it · ${ctx.io.fmt.accent('atoll doctor')} checks the setup`,
  );
  return 0;
}

/* ── atoll add [framework] <kind> [variant] [name] ───────────────────────── */

const ADD_KINDS = [
  'worker',
  'memory',
  'island',
  'mfe',
  'service',
  'method',
  'module',
  'housed',
  'route',
  'component',
  'instrumentation',
] as const;
type AddKind = (typeof ADD_KINDS)[number];

/** null = any host; otherwise the only frameworks the kind applies to. */
const KIND_SCOPE: Record<AddKind, readonly Framework[] | null> = {
  worker: null,
  memory: null,
  island: ISLAND_FRAMEWORKS,
  mfe: ISLAND_FRAMEWORKS,
  service: ['nestjs'],
  method: ['nestjs'],
  module: ['nestjs'],
  housed: ['nestjs'],
  route: ['nextjs'],
  component: ['nextjs'],
  instrumentation: ['nextjs'],
};

/**
 * Kinds with named variants — `add island facade counter`,
 * `add nextjs route task digest`. Also settable via --variant; when absent
 * an interactive session picks, a scripted run takes the first listed.
 */
const KIND_VARIANTS: Partial<Record<AddKind, readonly string[]>> = {
  island: ['facade', 'mono'],
  route: ['task', 'client'],
};

/** Positional framework words — `add react island …` overrides detection. */
const FRAMEWORK_WORDS: readonly Framework[] = [
  'angular',
  'nestjs',
  'nextjs',
  'node',
  'react',
  'solid',
  'svelte',
  'vanilla',
  'vue',
];

async function pickName(ctx: Ctx, kind: string, given?: string): Promise<string | null> {
  const name = given ?? flag(ctx.args, 'name') ?? (await ctx.io.ask(`${kind} name (kebab-case):`, ''));
  if (!name || !validName(name)) {
    ctx.io.error(
      `invalid ${kind} name ${ctx.io.fmt.accent(name)} — lowercase kebab-case, e.g. incidents-report`,
    );
    return null;
  }
  return name;
}

/** Locate the contract import for a generated worker in `dir`. */
function resolveMemory(
  ctx: Ctx,
  dir: string,
  name: string,
): { import_: string; export_: string } | null {
  if (hasFlag(ctx.args, 'no-memory')) return null;
  const want = flag(ctx.args, 'memory') ?? name;
  const direct = join(dir, `${want}.memory.ts`);
  if (existsSync(direct)) {
    return { import_: `./${want}.memory`, export_: `${camel(want)}Memory` };
  }
  // A lone *.memory.ts in the dir is the obvious contract — wire it.
  const candidates = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.memory.ts'))
    .map((e) => e.name.slice(0, -'.memory.ts'.length));
  const only = candidates.length === 1 ? candidates[0] : null;
  return only ? { import_: `./${only}.memory`, export_: `${camel(only)}Memory` } : null;
}

export async function runAdd(ctx: Ctx): Promise<number> {
  const project = detectProject(ctx.cwd);
  if (!project.root) {
    ctx.io.error('no package.json found — cd into a project or run `atoll new`');
    return 1;
  }
  const rel = (abs: string) => relative(ctx.cwd, abs).replaceAll('\\', '/');

  // Grammar: add [framework] <kind> [variant] [name]
  let rest = ctx.args._.slice(1);
  let framework = flag(ctx.args, 'framework') as Framework | undefined;
  if (rest[0] && (FRAMEWORK_WORDS as readonly string[]).includes(rest[0])) {
    framework ??= rest[0] as Framework;
    rest = rest.slice(1);
  }
  framework ??= project.framework;

  let kind = rest[0] as AddKind | undefined;
  if (!kind) {
    const available = ADD_KINDS.filter(
      (k) => !KIND_SCOPE[k] || KIND_SCOPE[k].includes(framework!),
    );
    kind = ctx.io.interactive
      ? ((await ctx.io.select('add what?', available, available[0])) as AddKind)
      : undefined;
    if (!kind) {
      ctx.io.error(`expected a kind — ${ADD_KINDS.join(' | ')}`);
      return 1;
    }
    rest = [kind, ...rest.slice(1)];
  }
  if (!(ADD_KINDS as readonly string[]).includes(kind)) {
    ctx.io.error(`unknown add target ${ctx.io.fmt.accent(kind)} — expected ${ADD_KINDS.join(' | ')}`);
    return 1;
  }
  const scope = KIND_SCOPE[kind];
  if (scope && !scope.includes(framework)) {
    ctx.io.error(
      `${kind} is for ${scope.join('/')} projects — detected "${framework}". Pass a framework word (e.g. \`atoll add nestjs ${kind} …\`) to override.`,
    );
    return 1;
  }

  // Variant — positional when it matches, --variant flag, else a pick.
  const variants = KIND_VARIANTS[kind];
  let variant: string | undefined;
  let nameArg: string | undefined;
  if (variants) {
    if (rest[1] && variants.includes(rest[1])) {
      variant = rest[1];
      nameArg = rest[2];
    } else {
      nameArg = rest[1];
    }
    variant = flag(ctx.args, 'variant') ?? variant;
    if (variant && !variants.includes(variant)) {
      ctx.io.error(`unknown ${kind} variant ${ctx.io.fmt.accent(variant)} — pick ${variants.join(' | ')}`);
      return 1;
    }
    variant ??= ctx.io.interactive
      ? await ctx.io.select(`${kind} variant:`, variants, variants[0])
      : variants[0];
  } else {
    nameArg = rest[1];
  }

  const name = await pickName(ctx, kind, nameArg);
  if (!name) return 1;
  const force = { force: hasFlag(ctx.args, 'force') };
  const atollDir = flag(ctx.args, 'dir') ?? rel(join(project.srcDir, 'atoll'));
  const c = camel(name);
  const P = pascal(name);

  switch (kind) {
    case 'memory': {
      await writeTree(
        ctx.io,
        ctx.cwd,
        [{ path: `${atollDir}/${name}.memory.ts`, content: T.memoryContract(name) }],
        force,
      );
      ctx.io.print(
        `\nbind it: pass ${ctx.io.fmt.accent(`${c}Memory`)} as ${ctx.io.fmt.accent('sharedMemory')} to defineWorker/connectWorker,`,
      );
      ctx.io.print(
        `or ${ctx.io.fmt.accent(`atoll add worker ${name}`)} in the same directory wires it automatically.`,
      );
      return 0;
    }

    case 'worker': {
      const dir = atollDir;
      mkdirSync(join(ctx.cwd, dir), { recursive: true });
      const host = hostOf(framework);
      const mem = resolveMemory(ctx, join(ctx.cwd, dir), name);
      const opts = {
        host,
        memoryImport: mem?.import_ ?? null,
        memoryName: mem?.export_,
        distUrl: `${relative(join(ctx.cwd, dir), join(project.root, 'dist')).replaceAll('\\', '/')}/${name}.worker.js`,
      };
      const bindings = T.workerBindingsFile(name, framework, dir, mem);
      await writeTree(
        ctx.io,
        ctx.cwd,
        [
          { path: `${dir}/${name}.worker.ts`, content: T.workerEntry(name, opts) },
          { path: `${dir}/${name}.ts`, content: T.workerClientFile(name, opts) },
          ...(bindings ? [bindings] : []),
        ],
        force,
      );
      ctx.io.print('');
      if (host === 'node') {
        ctx.io.print(`bundle before spawning — add to package.json scripts:`);
        ctx.io.print(
          ctx.io.fmt.accent(
            `  "bundle:${name}": "esbuild ${dir}/${name}.worker.ts --bundle --platform=node --format=esm --packages=external --outfile=dist/${name}.worker.js"`,
          ),
        );
      } else {
        ctx.io.print(
          `call ${ctx.io.fmt.accent(`${c}.echo('hi')`)} — the pool spawns lazily on first call`,
        );
        if (bindings) ctx.io.print(`framework bindings: ${ctx.io.fmt.accent(bindings.path)}`);
      }
      return 0;
    }

    case 'island': {
      const dir = flag(ctx.args, 'dir') ?? rel(join(project.srcDir, 'islands'));
      const files =
        variant === 'facade'
          ? T.islandFacadeFiles(name, framework, dir)
          : T.islandFiles(name, framework, dir);
      await writeTree(ctx.io, ctx.cwd, files, force);
      const usage =
        variant === 'facade' ? T.islandFacadeUsage(name, framework) : T.islandUsage(name, framework);
      if (usage) {
        ctx.io.print(ctx.io.fmt.strong('\nshell side:'));
        ctx.io.print(usage);
      }
      return 0;
    }

    case 'mfe': {
      const dir = flag(ctx.args, 'dir') ?? rel(join(project.srcDir, 'mfe'));
      const files = T.mfeFiles(name, framework, dir);
      // The publish build lives at the project root beside vite.config.ts —
      // it exists only for `vite build --config`, never the app dev server.
      const publishCfg = rel(join(project.root!, 'vite.mfe.config.ts'));
      // The config lives at the project root — the lib entry must be
      // root-relative even when `add` ran from a subdirectory or --dir moved.
      const dirFromRoot = relative(project.root!, join(ctx.cwd, dir)).replaceAll('\\', '/');
      await writeTree(
        ctx.io,
        ctx.cwd,
        [
          ...files,
          { path: publishCfg, content: T.mfePublishConfig(name, framework, dirFromRoot) },
        ],
        force,
      );
      if (missingDeps(project.pkg, ['vite']).length) {
        ctx.io.warn(
          `vite isn't installed — the publish build needs it: ${ctx.io.fmt.accent(pmInstallCmd(project.pm, ['-D', 'vite']))}`,
        );
      }
      ctx.io.print(ctx.io.fmt.strong('\nwire it:'));
      ctx.io.print(T.mfeUsage(name, framework, dir));
      return 0;
    }

    case 'service': {
      const dir = atollDir;
      mkdirSync(join(ctx.cwd, dir), { recursive: true });
      const mem = resolveMemory(ctx, join(ctx.cwd, dir), name);
      await writeTree(ctx.io, ctx.cwd, T.nestjsServiceFiles(name, dir, mem), force);
      ctx.io.print('');
      ctx.io.print(
        `inject ${ctx.io.fmt.accent(`${P}Service`)} anywhere — every method dispatches to the ${ctx.io.fmt.accent(`'${name}'`)} pool.`,
      );
      return 0;
    }

    case 'method': {
      const dir = atollDir;
      mkdirSync(join(ctx.cwd, dir), { recursive: true });
      await writeTree(ctx.io, ctx.cwd, T.nestjsMethodFiles(name, dir), force);
      ctx.io.print('');
      ctx.io.print(
        `needs a '${name}' pool — ${ctx.io.fmt.accent(`atoll add nestjs module ${name}`)} registers one,`,
      );
      ctx.io.print(`and the worker entry must runAtollWorker a module providing ${P}Service.`);
      return 0;
    }

    case 'module': {
      const dir = atollDir;
      mkdirSync(join(ctx.cwd, dir), { recursive: true });
      const mem = resolveMemory(ctx, join(ctx.cwd, dir), name);
      await writeTree(ctx.io, ctx.cwd, T.nestjsModuleFiles(name, dir, { mem }), force);
      ctx.io.print('');
      ctx.io.print(
        `import ${ctx.io.fmt.accent(`${P}Module`)} into AppModule — then ${ctx.io.fmt.accent(`atoll add nestjs service ${name}`)} adds the facade.`,
      );
      return 0;
    }

    case 'housed': {
      const dir = atollDir;
      mkdirSync(join(ctx.cwd, dir), { recursive: true });
      await writeTree(ctx.io, ctx.cwd, T.nestjsHousedFiles(name, dir), force);
      ctx.io.print('');
      ctx.io.print(ctx.io.fmt.strong('wire the gateway:'));
      ctx.io.print(T.nestjsHousedWiring(name));
      ctx.io.print(ctx.io.fmt.dim(`routes live only in workers — GET /api/${name}/whoami`));
      return 0;
    }

    case 'route': {
      const dir = flag(ctx.args, 'dir') ?? rel(join(project.srcDir, 'app/api', name));
      await writeTree(
        ctx.io,
        ctx.cwd,
        T.nextjsRouteFiles(name, dir, variant as 'task' | 'client'),
        force,
      );
      ctx.io.print('');
      ctx.io.print(
        `${ctx.io.fmt.accent(`POST /api/${name}`)} dispatches into the pool · ${ctx.io.fmt.accent(`GET /api/${name}`)} reads shared memory.`,
      );
      ctx.io.print(
        ctx.io.fmt.dim(`warm it at boot: atoll add nextjs instrumentation ${name}`),
      );
      return 0;
    }

    case 'component': {
      const dir = atollDir;
      mkdirSync(join(ctx.cwd, dir), { recursive: true });
      const mem = resolveMemory(ctx, join(ctx.cwd, dir), name);
      await writeTree(ctx.io, ctx.cwd, T.nextjsComponentFiles(name, dir, mem), force);
      ctx.io.print('');
      ctx.io.print(
        `expects the ${ctx.io.fmt.accent(`./${name}`)} client + contract beside it — ${ctx.io.fmt.accent(`atoll add nextjs worker ${name}`)} first.`,
      );
      return 0;
    }

    case 'instrumentation': {
      await writeTree(
        ctx.io,
        ctx.cwd,
        [T.nextjsInstrumentationFile(name, rel(project.srcDir))],
        force,
      );
      ctx.io.print(
        `\npools warm at boot — extend register() as more routes appear.`,
      );
      return 0;
    }

    default:
      ctx.io.error(`unhandled add kind ${kind}`);
      return 1;
  }
}

/* ── atoll new <dir> ────────────────────────────────────────────────────── */

const NEW_FRAMEWORKS = ['react', 'vue', 'solid', 'svelte', 'node'] as const;

export async function runCreate(ctx: Ctx): Promise<number> {
  let dirName = ctx.args._[1] ?? flag(ctx.args, 'dir');
  if (!dirName) dirName = await ctx.io.ask('project directory:', 'my-atoll-app');
  if (!validName(dirName)) {
    ctx.io.error(`invalid directory name ${ctx.io.fmt.accent(dirName)}`);
    return 1;
  }

  const fwFlag = flag(ctx.args, 'framework') as Framework | undefined;
  const fw =
    fwFlag ??
    (await ctx.io.select('framework:', NEW_FRAMEWORKS, 'react'));
  if (fw === 'angular') {
    ctx.io.error('angular apps scaffold through the CLI: `ng new <name>`, then `atoll init` + `atoll add island`');
    return 1;
  }
  if (!(NEW_FRAMEWORKS as readonly string[]).includes(fw)) {
    ctx.io.error(`unknown framework "${fw}" — pick from ${NEW_FRAMEWORKS.join(', ')}`);
    return 1;
  }

  const target = join(ctx.cwd, dirName);
  if (existsSync(target) && readdirSync(target).length > 0) {
    ctx.io.error(`${dirName}/ exists and is not empty`);
    return 1;
  }
  mkdirSync(target, { recursive: true });

  const mfe = hasFlag(ctx.args, 'mfe');
  if (mfe && fw === 'node') {
    ctx.io.error('--mfe is a browser-island shape — pick react|vue|solid|svelte');
    return 1;
  }
  const files =
    fw === 'node'
      ? T.nodeScaffoldFiles(dirName)
      : mfe
        ? T.mfeScaffoldFiles(dirName, fw)
        : T.scaffoldFiles(dirName, fw);
  await writeTree(ctx.io, target, files, { force: true });

  const written = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
  const allDeps = [
    ...Object.keys(written.dependencies ?? {}),
    ...Object.keys(written.devDependencies ?? {}),
  ];
  const pm = (flag(ctx.args, 'pm') as Pm | undefined) ?? 'npm';
  await offerInstall(
    { ...ctx, cwd: target },
    { root: target, pkg: {}, framework: 'vanilla', pm, srcDir: target },
    allDeps,
    true, // fresh scaffold — the deps are declared, nothing is installed yet
  );

  ctx.io.print('');
  ctx.io.print(`done — ${ctx.io.fmt.accent(`cd ${dirName} && ${pm} run dev`)}`);
  if (mfe) {
    ctx.io.print(
      `  ${ctx.io.fmt.accent('npm run build:mfe')} → dist-mfe/${dirName}.worker.js — publish behind CORS + a versioned URL`,
    );
    ctx.io.print(
      `  ${ctx.io.fmt.accent('npm run preview:mfe')} serves it cross-origin; shells mount the contract`,
    );
  }
  return 0;
}

/* ── atoll devtools ─────────────────────────────────────────────────────── */

/**
 * `atoll devtools [--port N]` — boot the local devtools server + dashboard.
 * The server lives in @atolljs/devtools: resolved as an installed package in
 * consumer projects, with a relative fallback so `npm run atoll devtools`
 * works inside the atoll monorepo where the package isn't installed.
 *
 * Never resolves — the process serves until SIGINT.
 */
export async function runDevtools(ctx: Ctx): Promise<number> {
  const { io } = ctx;
  const spec = '@atolljs/devtools/server';
  const mod: { createDevtoolsServer?: (o: { port: number }) => Promise<{ url: string }> } | null =
    await import(spec).catch(async () => {
      // In-repo fallback: the workspace package's built dist (extensionless
      // sources can't run under type stripping — `npm run build` there first).
      const local = new URL('../../devtools/dist/server.js', import.meta.url).href;
      return import(local).catch(() => null);
    });
  if (!mod?.createDevtoolsServer) {
    io.error(`@atolljs/devtools isn't installed — ${io.fmt.accent('npm i -D @atolljs/devtools')}`);
    return 1;
  }
  const port = Number(flag(ctx.args, 'port') ?? 4780);
  const server = await mod.createDevtoolsServer({ port: Number.isFinite(port) ? port : 4780 });
  io.print(`atoll devtools → ${io.fmt.accent(server.url)}`);
  io.print(io.fmt.dim('  ingest endpoint: ' + server.url.replace('http://', 'ws://') + '/events'));
  io.print(io.fmt.dim("  in the app: connectDevtools() from '@atolljs/devtools'"));
  io.warn('serving — Ctrl+C to stop');
  return new Promise<number>(() => {});
}

/* ── atoll doctor ───────────────────────────────────────────────────────── */

interface Check {
  label: string;
  run(): { level: 'pass' | 'warn' | 'fail'; detail?: string };
}

export function runDoctor(ctx: Ctx): number {
  const project = detectProject(ctx.cwd);
  const fix = hasFlag(ctx.args, 'fix');
  const checks: Check[] = [
    {
      label: 'node >= 22.18 (type-stripped CLI) / >= 20 (runtime)',
      run: () => {
        const [maj, min] = process.versions.node.split('.').map(Number);
        return maj > 22 || (maj === 22 && min >= 18)
          ? { level: 'pass', detail: `v${process.versions.node}` }
          : maj >= 20
            ? { level: 'warn', detail: `v${process.versions.node} — runtime OK; the CLI bin needs >=22.18` }
            : { level: 'fail', detail: `v${process.versions.node}` };
      },
    },
    {
      label: 'package.json',
      run: () =>
        project.pkg
          ? { level: 'pass', detail: `${project.root}/package.json` }
          : { level: 'fail', detail: 'not found — run `atoll new` or cd into a project' },
    },
    {
      label: '@atolljs/* dependencies',
      run: () => {
        const deps = { ...project.pkg?.dependencies, ...project.pkg?.devDependencies };
        const found = Object.keys(deps).filter((d) => d.startsWith('@atolljs/'));
        return found.length
          ? { level: 'pass', detail: found.join(', ') }
          : { level: 'warn', detail: 'none — `atoll init` installs what the framework needs' };
      },
    },
    {
      label: '.npmrc supply-chain policy (min-release-age)',
      run: () => {
        const p = join(project.root ?? ctx.cwd, '.npmrc');
        const has = existsSync(p) && readFileSync(p, 'utf8').includes('min-release-age');
        if (has) return { level: 'pass' };
        if (fix) {
          writeFileSync(p, T.NPMRC);
          return { level: 'pass', detail: 'written (--fix)' };
        }
        return { level: 'warn', detail: 'missing — `atoll doctor --fix` writes the hardened .npmrc' };
      },
    },
    {
      label: 'lockfile present',
      run: () =>
        existsSync(join(project.root ?? ctx.cwd, 'package-lock.json')) ||
        existsSync(join(project.root ?? ctx.cwd, 'pnpm-lock.yaml')) ||
        existsSync(join(project.root ?? ctx.cwd, 'yarn.lock'))
          ? { level: 'pass' }
          : { level: 'warn', detail: 'no lockfile — installs are not reproducible' },
    },
    {
      label: 'worker entries bundler-detectable',
      run: () => {
        if (!project.srcDir || !existsSync(project.srcDir)) return { level: 'pass' };
        let scanned = 0;
        let bad = 0;
        const walk = (d: string) => {
          for (const e of readdirSync(d, { withFileTypes: true })) {
            const p = join(d, e.name);
            if (e.isDirectory() && e.name !== 'node_modules') walk(p);
            else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) {
              scanned++;
              const src = readFileSync(p, 'utf8');
              const entries = src.match(/new Worker\s*\(/g) ?? [];
              const detectable = src.match(/new Worker\s*\(\s*new URL\s*\(/g) ?? [];
              bad += entries.length - detectable.length;
            }
          }
        };
        walk(project.srcDir);
        return bad
          ? { level: 'fail', detail: `${bad} new Worker() call(s) without \`new URL(..., import.meta.url)\` — bundlers can't see them` }
          : { level: 'pass', detail: `${scanned} files scanned` };
      },
    },
    {
      label: 'COOP/COEP headers (SharedArrayBuffer gate)',
      run: () => {
        if (NODE_HOSTS.includes(project.framework)) {
          return { level: 'pass', detail: 'n/a — node runtime' };
        }
        const vite = ['vite.config.ts', 'vite.config.js', 'vite.config.mts']
          .map((f) => join(project.root ?? ctx.cwd, f))
          .find(existsSync);
        if (!vite) return { level: 'warn', detail: 'no vite config found — verify headers on your server' };
        const src = readFileSync(vite, 'utf8');
        return src.includes('Cross-Origin-Opener-Policy') && src.includes('Cross-Origin-Embedder-Policy')
          ? { level: 'pass' }
          : { level: 'warn', detail: `${vite.split(/[\\/]/).pop()} lacks COOP/COEP — shared memory will be gated in dev` };
      },
    },
  ];

  let fails = 0;
  for (const c of checks) {
    const r = c.run();
    const mark = r.level === 'pass' ? 'ok' : r.level === 'warn' ? 'warn' : 'error';
    ctx.io[mark](`${c.label}${r.detail ? ctx.io.fmt.dim(` — ${r.detail}`) : ''}`);
    if (r.level === 'fail') fails++;
  }
  return fails ? 1 : 0;
}

