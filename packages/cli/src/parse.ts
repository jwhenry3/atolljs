export interface ParsedArgs {
  /** Positional args (commands, names). */
  _: string[];
  /** `--flag`, `--flag=value`, `--flag value`, `-abc` shorts. */
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const _: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      _.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
        flags[a.slice(2)] = argv[++i];
      } else {
        flags[a.slice(2)] = true;
      }
    } else if (a.startsWith('-') && a.length > 1) {
      for (const ch of a.slice(1)) flags[ch] = true;
    } else {
      _.push(a);
    }
  }
  return { _, flags };
}

export const flag = (args: ParsedArgs, name: string): string | undefined =>
  typeof args.flags[name] === 'string' ? (args.flags[name] as string) : undefined;

export const hasFlag = (args: ParsedArgs, ...names: string[]): boolean =>
  names.some((n) => args.flags[n] === true || typeof args.flags[n] === 'string');

/** kebab-case → camelCase (`incidents-api` → `incidentsApi`). */
export const camel = (name: string): string =>
  name.replace(/[-_](.)/g, (_m, c: string) => c.toUpperCase());

/** kebab-case → PascalCase (`incidents-api` → `IncidentsApi`). */
export const pascal = (name: string): string => {
  const c = camel(name);
  return c.charAt(0).toUpperCase() + c.slice(1);
};

/** Validate a generated-file basename — keeps paths inside the target dir. */
export const validName = (name: string): boolean =>
  /^[a-z][a-z0-9]*([-_][a-z0-9]+)*$/.test(name);
