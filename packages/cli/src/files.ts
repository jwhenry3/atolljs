import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import type { Io } from './io.ts';

export interface OutFile {
  /** Path relative to the command's cwd. */
  path: string;
  content: string;
}

/**
 * Write a set of files under `cwd`. Existing files are never silently
 * clobbered — `--force` overwrites, interactive sessions get a prompt, and
 * non-interactive runs skip with a warning.
 */
export async function writeTree(
  io: Io,
  cwd: string,
  files: readonly OutFile[],
  opts: { force?: boolean } = {},
): Promise<void> {
  for (const f of files) {
    const abs = normalize(join(cwd, f.path));
    if (!abs.startsWith(normalize(cwd))) {
      io.error(`refusing to write outside the project: ${io.fmt.accent(f.path)}`);
      continue;
    }
    if (existsSync(abs) && !opts.force) {
      const overwrite = io.interactive
        ? await io.confirm(`${io.fmt.accent(f.path)} exists — overwrite?`, false)
        : false;
      if (!overwrite) {
        io.warn(
          `skipped ${io.fmt.accent(f.path)} (exists — pass ${io.fmt.accent('--force')} to overwrite)`,
        );
        continue;
      }
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, f.content);
    io.ok(`created ${io.fmt.accent(f.path)}`);
  }
}
