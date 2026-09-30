import { createInterface, type Interface } from 'node:readline/promises';
import { stdin, stdout, stderr } from 'node:process';
import { styleText } from 'node:util';

/**
 * Semantic styling — commands print `fmt.accent('cd foo')` instead of raw
 * ANSI, so `scriptIo` (identity) keeps test output clean and piped runs
 * emit no escape codes at all.
 */
export interface Fmt {
  /** Bold — headings, prompts, the thing to notice. */
  strong(s: string): string;
  /** Dim — secondary detail, defaults, asides. */
  dim(s: string): string;
  /** Accent — commands, flags, and file paths the user should copy. */
  accent(s: string): string;
}

const PLAIN_FMT: Fmt = { strong: (s) => s, dim: (s) => s, accent: (s) => s };

/**
 * The IO seam — every command takes an Io so tests can script answers and
 * capture output without a TTY. Non-interactive sessions (piped, `--yes`,
 * tests) resolve every prompt to its declared default.
 */
export interface Io {
  readonly interactive: boolean;
  readonly fmt: Fmt;
  print(msg?: string): void;
  ok(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  ask(question: string, fallback?: string): Promise<string>;
  confirm(question: string, def?: boolean): Promise<boolean>;
  select<T extends string>(question: string, choices: readonly T[], def: T): Promise<T>;
  close(): void;
}

export function consoleIo(interactive: boolean): Io {
  // NO_COLOR opts out, FORCE_COLOR opts in — otherwise a TTY decides.
  const color =
    process.env.NO_COLOR === undefined &&
    (process.env.FORCE_COLOR !== undefined || stdout.isTTY === true);
  const style = (f: Parameters<typeof styleText>[0]) => (s: string) =>
    color ? styleText(f, s) : s;
  const fmt: Fmt = color
    ? { strong: style('bold'), dim: style('dim'), accent: style('cyan') }
    : PLAIN_FMT;
  const okMark = style('green')(' ✓ ');
  const warnMark = style('yellow')(' ! ');
  const errorMark = style('red')(' ✗ ');
  const rl: Interface | null = interactive
    ? createInterface({ input: stdin, output: stdout })
    : null;
  return {
    interactive,
    fmt,
    print: (msg = '') => stdout.write(msg + '\n'),
    ok: (msg) => stdout.write(`${okMark} ${msg}\n`),
    warn: (msg) => stdout.write(`${warnMark} ${msg}\n`),
    error: (msg) => stderr.write(`${errorMark} ${msg}\n`),
    async ask(question, fallback = '') {
      if (!rl) return fallback;
      const answer = (await rl.question(`${fmt.strong(question)} `)).trim();
      return answer || fallback;
    },
    async confirm(question, def = false) {
      if (!rl) return def;
      const hint = fmt.dim(`[${def ? 'Y/n' : 'y/N'}]`);
      const answer = (await rl.question(`${fmt.strong(question)} ${hint} `))
        .trim()
        .toLowerCase();
      return answer === '' ? def : answer === 'y' || answer === 'yes';
    },
    async select(question, choices, def) {
      if (!rl) return def;
      stdout.write(fmt.strong(question) + '\n');
      choices.forEach((c, i) =>
        stdout.write(
          `  ${fmt.accent(String(i + 1))}) ${c}${c === def ? fmt.dim(' (default)') : ''}\n`,
        ),
      );
      const answer = (
        await rl.question(`${fmt.dim(`choose [1-${choices.length}]:`)} `)
      ).trim();
      if (answer === '') return def;
      const pick = choices[Number(answer) - 1] ?? choices.find((c) => c === answer);
      return pick ?? def;
    },
    close: () => rl?.close(),
  };
}

/** Test/script driver — canned answers in order, output captured for assertions. */
export function scriptIo(answers: readonly (string | boolean)[] = []): Io & { output: string[] } {
  const output: string[] = [];
  const queue = [...answers];
  const next = () => queue.shift();
  const io: Io & { output: string[] } = {
    interactive: true,
    fmt: PLAIN_FMT,
    output,
    print: (msg = '') => output.push(msg),
    ok: (msg) => output.push(`ok ${msg}`),
    warn: (msg) => output.push(`warn ${msg}`),
    error: (msg) => output.push(`error ${msg}`),
    async ask(_q, fallback = '') {
      const a = next();
      return typeof a === 'string' && a !== '' ? a : fallback;
    },
    async confirm(_q, def = false) {
      const a = next();
      if (typeof a === 'boolean') return a;
      if (typeof a === 'string' && a !== '') return a.toLowerCase().startsWith('y');
      return def;
    },
    async select(_q, choices, def) {
      const a = next();
      if (typeof a === 'string' && a !== '') {
        return choices[Number(a) - 1] ?? choices.find((c) => c === a) ?? def;
      }
      return def;
    },
    close: () => {},
  };
  return io;
}
