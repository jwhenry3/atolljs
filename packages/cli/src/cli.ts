#!/usr/bin/env node
/**
 * `atoll` — bootstrap multithreading in an app: worker pools, shared-memory
 * contracts, framework islands, and a doctor that checks the setup.
 *
 * Ships as TypeScript — Node >= 22.18 runs it via native type stripping.
 * Keep every relative import's `.ts` extension explicit and stay inside
 * erasable syntax (no enums, namespaces, or parameter properties).
 */
import { consoleIo, type Fmt, type Io } from './io.ts';
import { hasFlag, parseArgs } from './parse.ts';
import { runAdd, runCreate, runDoctor, runInit, type Ctx } from './commands.ts';

const HELP = (fmt: Fmt) => `${fmt.strong('atoll')} — bootstrap multithreading

  ${fmt.accent('atoll new <dir>')} [--framework react|vue|solid|svelte|node] [--pm npm]
      Scaffold a fresh app — vite shell + a worker-rendered island,
      or a tsx Node service with a pooled worker.

  ${fmt.accent('atoll init')} [--name app] [--force]
      Wire Atoll into the current project: hardened .npmrc, package
      install, and a contract + worker + client spine under src/atoll/.

  ${fmt.accent('atoll add [framework] <kind> [variant] [name]')}
      worker      pool + typed client (+ framework bindings on UI projects)
      memory      shared-memory contract
      island      worker-rendered UI — facade (contract + lazy import) | mono
      service     nestjs: @AtollService class facade + pool module + worker
      method      nestjs: @AtollTask method-level offload
      module      nestjs: registerPool boundary module + worker entry
      housed      nestjs: route subtree served entirely inside workers
      route       nextjs: api route pool — task | client variants
      component   nextjs: 'use client' hooks component over a pool
      instrumentation   nextjs: server bootstrap that warms route pools

      Frameworks: react vue solid svelte angular nestjs nextjs node
      [--dir <path>] [--memory <name>|--no-memory] [--variant <v>] [--force]

  ${fmt.accent('atoll doctor')} [--fix]
      Check the setup — deps, lockfile, .npmrc policy, bundler-detectable
      worker entries, COOP/COEP headers. --fix writes a hardened .npmrc.

  ${fmt.dim(`flags: --yes/-y accepts defaults, --force overwrites existing files,
         --no-install skips dependency installation`)}
`;

export async function runCli(argv: readonly string[], io: Io, cwd: string): Promise<number> {
  const args = parseArgs(argv);
  const ctx: Ctx = { io, cwd, args };
  const [cmd] = args._;

  try {
    switch (cmd) {
      case 'new':
      case 'create':
        return await runCreate(ctx);
      case 'init':
        return await runInit(ctx);
      case 'add':
        return await runAdd(ctx);
      case 'doctor':
        return runDoctor(ctx);
      case 'help':
      case undefined:
        io.print(HELP(io.fmt));
        return cmd === undefined ? 0 : 0;
      default:
        io.error(`unknown command ${io.fmt.accent(cmd)}`);
        io.print(HELP(io.fmt));
        return 1;
    }
  } catch (e) {
    io.error(e instanceof Error ? e.message : String(e));
    return 1;
  } finally {
    io.close();
  }
}

// Entry guard — the file is also imported by tests, which pass their own io.
const invokedAs =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/'));
if (invokedAs) {
  const args = parseArgs(process.argv.slice(2));
  const interactive = process.stdin.isTTY === true && !hasFlag(args, 'yes', 'y');
  const code = await runCli(process.argv.slice(2), consoleIo(interactive), process.cwd());
  process.exit(code);
}
