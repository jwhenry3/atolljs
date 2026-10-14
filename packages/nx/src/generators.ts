import { logger, readProjectConfiguration, type Tree } from '@nx/devkit';
import { join, relative } from 'node:path';
import { runAtoll } from './atoll';

export interface InitSchema {
  name?: string;
  project?: string;
  directory?: string;
  framework?: string;
  force?: boolean;
  install?: boolean;
}

export interface AddSchema {
  name?: string;
  project?: string;
  directory?: string;
  framework?: string;
  variant?: string;
  memory?: string;
  noMemory?: boolean;
  force?: boolean;
  install?: boolean;
}

type AddKind =
  | 'worker'
  | 'memory'
  | 'island'
  | 'mfe'
  | 'service'
  | 'method'
  | 'module'
  | 'housed'
  | 'route'
  | 'component'
  | 'instrumentation'
  | 'devtools';

/**
 * Each `atoll add <kind>` has its own default dir derived from the detected
 * project's srcDir. In an Nx workspace detection lands on the workspace-root
 * package.json — so the project's sourceRoot is translated into an explicit
 * --dir (workspace-root-relative here, cwd-relative by the time it reaches
 * the CLI).
 */
const defaultDir = (kind: AddKind, sourceRoot: string, name?: string): string => {
  switch (kind) {
    case 'island':
      return `${sourceRoot}/islands`;
    case 'mfe':
      return `${sourceRoot}/mfe`;
    case 'route':
      return `${sourceRoot}/app/api/${name}`;
    case 'instrumentation':
      return sourceRoot; // writes <dir>/instrumentation.ts
    default:
      return `${sourceRoot}/atoll`;
  }
};

/**
 * Where the CLI spawns. With --project it runs inside the project dir, so a
 * project-level package.json (publishable libs) wins detection and `mfe`'s
 * publish config lands in the project — without one, detection walks up to
 * the workspace root as usual.
 */
function target(
  tree: Tree,
  project?: string,
): { cwd: string; sourceRoot: string | null } {
  if (!project) return { cwd: tree.root, sourceRoot: null };
  const cfg = readProjectConfiguration(tree, project);
  return {
    cwd: join(tree.root, cfg.root),
    sourceRoot: cfg.sourceRoot ?? join(cfg.root, 'src').replaceAll('\\', '/'),
  };
}

/** `directory`/`sourceRoot` are workspace-root-relative; the CLI wants cwd-relative. */
const cwdRelative = (tree: Tree, cwd: string, dir: string): string =>
  relative(cwd, join(tree.root, dir)).replaceAll('\\', '/');

function invoke(tree: Tree, argv: string[], cwd: string): void {
  if (process.env.NX_DRY_RUN === 'true') {
    logger.info(`[dry-run] would run: atoll ${argv.join(' ')}`);
    return;
  }
  const code = runAtoll(argv, cwd);
  if (code !== 0) {
    throw new Error(`atoll ${argv.slice(0, 2).join(' ')} failed (exit ${code})`);
  }
}

/** `nx g @atolljs/nx:init` — also what `nx add @atolljs/nx` runs. */
export async function initGenerator(tree: Tree, options: InitSchema): Promise<void> {
  const { cwd, sourceRoot } = target(tree, options.project);
  const argv = ['init'];
  if (options.name) argv.push('--name', options.name);
  if (options.framework) argv.push('--framework', options.framework);
  if (options.force) argv.push('--force');
  if (options.install === false) argv.push('--no-install');
  const dir = options.directory ?? (sourceRoot ? `${sourceRoot}/atoll` : undefined);
  if (dir) argv.push('--dir', cwdRelative(tree, cwd, dir));
  invoke(tree, argv, cwd);
}

function addGenerator(kind: AddKind) {
  return async (tree: Tree, options: AddSchema): Promise<void> => {
    const { cwd, sourceRoot } = target(tree, options.project);
    const argv = ['add', kind];
    if (options.variant) argv.push('--variant', options.variant);
    if (options.name) argv.push(options.name);
    const dir =
      options.directory ??
      (sourceRoot ? defaultDir(kind, sourceRoot, options.name) : undefined);
    if (dir) argv.push('--dir', cwdRelative(tree, cwd, dir));
    if (options.framework) argv.push('--framework', options.framework);
    if (options.memory) argv.push('--memory', options.memory);
    if (options.noMemory) argv.push('--no-memory');
    if (options.force) argv.push('--force');
    if (options.install === false) argv.push('--no-install');
    invoke(tree, argv, cwd);
  };
}

export const workerGenerator = addGenerator('worker');
export const memoryGenerator = addGenerator('memory');
export const islandGenerator = addGenerator('island');
export const mfeGenerator = addGenerator('mfe');
export const serviceGenerator = addGenerator('service');
export const methodGenerator = addGenerator('method');
export const moduleGenerator = addGenerator('module');
export const housedGenerator = addGenerator('housed');
export const routeGenerator = addGenerator('route');
export const componentGenerator = addGenerator('component');
export const instrumentationGenerator = addGenerator('instrumentation');
export const devtoolsGenerator = addGenerator('devtools');
