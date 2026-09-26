/**
 * Scoped, leveled logging for the SDK. Default level is `info` — lifecycle
 * events (pool spawn, memory bind, seed phases) are always visible; `debug`
 * adds per-task dispatch/completion and `trace` adds per-message detail.
 *
 *   import { setLogLevel } from '…/index';
 *   setLogLevel('debug'); // or 'trace', 'warn', 'off'
 */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'off';

const LEVELS: Record<LogLevel, number> = { trace: 0, debug: 1, info: 2, warn: 3, error: 4, off: 5 };

export interface LogEntry {
  level: LogLevel;
  scope: string;
  message: string;
  data?: unknown;
  /** Which side of the boundary emitted this entry. */
  thread: 'main' | 'worker';
  /** performance.now() at emission — useful for sequencing across threads. */
  at: number;
}

export type LogSink = (entry: LogEntry) => void;

const THREAD: LogEntry['thread'] =
  typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope ? 'worker' : 'main';

const consoleSink: LogSink = ({ level, scope, message, data, thread, at }) => {
  const prefix = `[${(at / 1000).toFixed(2)}s ${thread}:${scope}]`;
  const fn =
    level === 'error' ? console.error
    : level === 'warn' ? console.warn
    : level === 'info' ? console.info
    : console.debug;
  if (data !== undefined) fn(`${prefix} ${message}`, data);
  else fn(`${prefix} ${message}`);
};

let minLevel: LogLevel = 'info';
let sink: LogSink = consoleSink;

export const setLogLevel = (level: LogLevel): void => { minLevel = level; };
export const getLogLevel = (): LogLevel => minLevel;
/** Replace the console sink (e.g. collect entries for a UI panel); null restores it. */
export const setLogSink = (custom: LogSink | null): void => { sink = custom ?? consoleSink; };

export function log(level: Exclude<LogLevel, 'off'>, scope: string, message: string, data?: unknown): void {
  if (LEVELS[level] < LEVELS[minLevel]) return;
  sink({ level, scope, message, data, thread: THREAD, at: performance.now() });
}

/** A logger bound to a subsystem scope: `poolLog.info('spawned')`. */
export function scoped(scope: string) {
  return {
    trace: (message: string, data?: unknown) => log('trace', scope, message, data),
    debug: (message: string, data?: unknown) => log('debug', scope, message, data),
    info: (message: string, data?: unknown) => log('info', scope, message, data),
    warn: (message: string, data?: unknown) => log('warn', scope, message, data),
    error: (message: string, data?: unknown) => log('error', scope, message, data),
  };
}

/** Compact byte formatting for log output. */
export const fmtBytes = (bytes: number): string =>
  bytes >= 1 << 20 ? `${(bytes / (1 << 20)).toFixed(1)}MB`
  : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)}KB`
  : `${bytes}B`;
