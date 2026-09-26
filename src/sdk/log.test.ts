import { afterEach, describe, expect, it } from 'vitest';
import { fmtBytes, getLogLevel, log, scoped, setLogLevel, setLogSink, type LogEntry } from './log';

describe('log', () => {
  const entries: LogEntry[] = [];

  afterEach(() => {
    entries.length = 0;
    setLogSink(null);
    setLogLevel('info');
  });

  it('emits entries with level, scope, message, thread and timestamp', () => {
    setLogSink((e) => entries.push(e));
    log('info', 'test', 'hello', { n: 1 });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: 'info',
      scope: 'test',
      message: 'hello',
      data: { n: 1 },
      thread: 'main',
    });
    expect(entries[0].at).toBeGreaterThanOrEqual(0);
  });

  it('filters entries below the configured level', () => {
    setLogSink((e) => entries.push(e));
    // default level is info — trace/debug are suppressed
    log('trace', 't', 'hidden');
    log('debug', 'd', 'hidden');
    log('info', 'i', 'shown');
    expect(entries.map((e) => e.level)).toEqual(['info']);

    setLogLevel('debug');
    log('debug', 'd', 'now visible');
    log('trace', 't', 'still hidden');
    expect(entries.map((e) => e.level)).toEqual(['info', 'debug']);
  });

  it('suppresses everything at level off', () => {
    setLogSink((e) => entries.push(e));
    setLogLevel('off');
    log('error', 'e', 'hidden');
    expect(entries).toHaveLength(0);
  });

  it('reports the current level via getLogLevel', () => {
    expect(getLogLevel()).toBe('info');
    setLogLevel('warn');
    expect(getLogLevel()).toBe('warn');
  });

  it('scoped() binds the scope and exposes per-level methods', () => {
    setLogLevel('trace');
    setLogSink((e) => entries.push(e));
    const poolLog = scoped('pool');
    poolLog.trace('t');
    poolLog.debug('d');
    poolLog.info('i');
    poolLog.warn('w');
    poolLog.error('e');
    expect(entries.map((e) => e.scope)).toEqual(['pool', 'pool', 'pool', 'pool', 'pool']);
    expect(entries.map((e) => e.level)).toEqual(['trace', 'debug', 'info', 'warn', 'error']);
  });

  it('omits data when not provided', () => {
    setLogSink((e) => entries.push(e));
    log('info', 's', 'no data');
    expect(entries[0].data).toBeUndefined();
  });
});

describe('fmtBytes', () => {
  it('formats bytes below a KB', () => {
    expect(fmtBytes(0)).toBe('0B');
    expect(fmtBytes(512)).toBe('512B');
  });

  it('formats KB and MB with one decimal', () => {
    expect(fmtBytes(2048)).toBe('2.0KB');
    expect(fmtBytes(32 << 20)).toBe('32.0MB');
  });
});
