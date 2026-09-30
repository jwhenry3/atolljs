import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type Framework =
  | 'angular'
  | 'nestjs'
  | 'nextjs'
  | 'node'
  | 'react'
  | 'solid'
  | 'svelte'
  | 'vanilla'
  | 'vue';

export type Pm = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface PkgJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

export interface ProjectInfo {
  /** Dir containing the nearest package.json, or null outside a project. */
  root: string | null;
  pkg: PkgJson | null;
  framework: Framework;
  pm: Pm;
  /** Preferred source dir — `src` when present, else the project root. */
  srcDir: string;
}

/** Walk up from `cwd` to the nearest dir containing a package.json. */
export function findRoot(cwd: string): string | null {
  let dir = cwd;
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function readPkg(dir: string): PkgJson | null {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PkgJson;
  } catch {
    return null;
  }
}

const DEPS_OF = (pkg: PkgJson | null): Record<string, string> => ({
  ...(pkg?.dependencies ?? {}),
  ...(pkg?.devDependencies ?? {}),
});

/**
 * Order is the contract — a nestjs app also depends on express-style libs,
 * a nextjs app also depends on react. Most specific host wins first.
 */
const DETECT: readonly [Framework, readonly string[]][] = [
  ['nestjs', ['@nestjs/core', '@nestjs/common']],
  ['nextjs', ['next']],
  ['angular', ['@angular/core']],
  ['svelte', ['svelte']],
  ['solid', ['solid-js']],
  ['vue', ['vue']],
  ['react', ['react', 'react-dom']],
  ['node', ['@atolljs/node', 'express', 'fastify', 'hono', 'koa', '@nestjs/core']],
];

export function detectFramework(pkg: PkgJson | null): Framework {
  const deps = DEPS_OF(pkg);
  for (const [fw, names] of DETECT) {
    if (names.some((n) => deps[n] !== undefined)) return fw;
  }
  return 'vanilla';
}

export function detectPm(root: string): Pm {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(root, 'bun.lockb')) || existsSync(join(root, 'bun.lock'))) return 'bun';
  return 'npm';
}

export function detectProject(cwd: string): ProjectInfo {
  const root = findRoot(cwd);
  if (!root) {
    return { root: null, pkg: null, framework: 'vanilla', pm: 'npm', srcDir: cwd };
  }
  const pkg = readPkg(root);
  return {
    root,
    pkg,
    framework: detectFramework(pkg),
    pm: detectPm(root),
    srcDir: existsSync(join(root, 'src')) ? join(root, 'src') : root,
  };
}

/** The dependency line `init` installs per detected framework (zod is
 *  part of the public API surface — generated workers declare schemas). */
export const ATOLL_DEPS: Record<Framework, readonly string[]> = {
  react: ['@atolljs/core', '@atolljs/react', '@atolljs/react-island', 'zod'],
  vue: ['@atolljs/core', '@atolljs/vue', '@atolljs/vue-island', 'zod'],
  solid: ['@atolljs/core', '@atolljs/solidjs', '@atolljs/solid-island', 'zod'],
  svelte: ['@atolljs/core', '@atolljs/svelte', '@atolljs/svelte-island', 'zod'],
  angular: ['@atolljs/core', '@atolljs/angular', '@atolljs/angular-island', 'zod'],
  nextjs: ['@atolljs/core', '@atolljs/nextjs', 'zod'],
  nestjs: ['@atolljs/core', '@atolljs/nestjs', '@atolljs/node', 'zod'],
  node: ['@atolljs/core', '@atolljs/node', 'zod'],
  vanilla: ['@atolljs/core', 'zod'],
};

export const ISLAND_FRAMEWORKS: readonly Framework[] = [
  'react',
  'vue',
  'solid',
  'svelte',
  'angular',
];

export const pmInstallCmd = (pm: Pm, pkgs: readonly string[]): string =>
  `${pm} ${pm === 'npm' ? 'install' : 'add'} ${pkgs.join(' ')}`;

/** Which deps from `want` are absent from the project's manifest. */
export function missingDeps(pkg: PkgJson | null, want: readonly string[]): string[] {
  const deps = DEPS_OF(pkg);
  return want.filter((d) => deps[d] === undefined);
}
