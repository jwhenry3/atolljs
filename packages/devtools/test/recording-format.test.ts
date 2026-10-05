import { describe, expect, it } from 'vitest';
// @ts-expect-error: plain-JS dashboard module without type declarations
import * as rf from '../app/panels/recording-format.js';

const sess = (id: string, name?: string) => ({ id, name, runtime: 'browser' as const });
const ev = (n: number) => Array.from({ length: n }, (_, i) => ({ type: 'log', i }));

describe('recording-format', () => {
  it('serializes captured frames, optionally narrowed to one session', () => {
    const a = sess('a', 'App A');
    const b = sess('b');
    const captured = [
      { t: 10, session: a, events: ev(1) },
      { t: 12, session: b, events: ev(2) },
      { t: 15, session: a, events: ev(3) },
    ];
    const all = rf.serializeRecording(captured, { exportedAt: 'X' });
    expect(all).toEqual({
      format: 'atoll-devtools-recording',
      version: 1,
      exportedAt: 'X',
      sessions: [a, b],
      frames: [
        { t: 10, sessionId: 'a', events: ev(1) },
        { t: 12, sessionId: 'b', events: ev(2) },
        { t: 15, sessionId: 'a', events: ev(3) },
      ],
    });
    const onlyA = rf.serializeRecording(captured, { sessionId: 'a' });
    expect(onlyA.sessions).toEqual([a]);
    expect(onlyA.frames.map((f: { t: number }) => f.t)).toEqual([10, 15]);
    // round-trips through JSON + validation
    const back = rf.validateRecording(JSON.parse(JSON.stringify(all)));
    expect(back.frames.map((f: { t: number }) => f.t)).toEqual([0, 2, 5]);
  });

  it('names files atoll-devtools-<session-or-all>-<yyyymmdd-hhmmss>.json', () => {
    const d = new Date(2026, 9, 4, 7, 5, 9);
    expect(rf.recordingFileName(null, d)).toBe('atoll-devtools-all-20261004-070509.json');
    expect(rf.recordingFileName('My App: /dash', d)).toBe('atoll-devtools-my-app-dash-20261004-070509.json');
  });

  it('rejects malformed recordings with a reason', () => {
    const ok = { format: 'atoll-devtools-recording', version: 1, sessions: [], frames: [] };
    expect(() => rf.validateRecording(null)).toThrow(/JSON object/);
    expect(() => rf.validateRecording({ ...ok, format: 'har' })).toThrow(/not an atoll/);
    expect(() => rf.validateRecording({ ...ok, version: 2 })).toThrow(/version/);
    expect(() => rf.validateRecording({ ...ok, frames: {} })).toThrow(/frames must be an array/);
    expect(() => rf.validateRecording({ ...ok, sessions: [{}] })).toThrow(/sessions\[0\]/);
    expect(() => rf.validateRecording({ ...ok, frames: [{ t: 'x', sessionId: 'a', events: [] }] })).toThrow(/frames\[0\]\.t/);
    expect(() => rf.validateRecording({ ...ok, frames: [{ t: 1, sessionId: 'a' }] })).toThrow(/events/);
    expect(rf.validateRecording(ok).frames).toEqual([]);
  });

  it('sorts and rebases frames; replay sessions are renamed and closed', () => {
    const rec = rf.validateRecording({
      format: 'atoll-devtools-recording', version: 1, exportedAt: 'X',
      sessions: [sess('a', 'App')],
      frames: [
        { t: 500, sessionId: 'a', events: ev(1) },
        { t: 100, sessionId: 'ghost', events: ev(2) },
      ],
    });
    expect(rec.frames.map((f: { t: number; sessionId: string }) => [f.t, f.sessionId])).toEqual([[0, 'ghost'], [400, 'a']]);
    const ss = rf.replaySessions(rec);
    expect(ss.get('a')).toMatchObject({ id: 'a', name: '⏺ App', closed: true });
    expect(ss.get('ghost')).toMatchObject({ id: 'ghost', name: '⏺ ghost', closed: true });
    expect(rf.recordingDuration(rec.frames)).toBe(400);
    expect(rf.countEvents(rec.frames)).toBe(3);
  });

  it('slices frames up to a playhead', () => {
    const frames = [0, 10, 10, 25, 40].map((t) => ({ t, sessionId: 'a', events: ev(1) }));
    expect(rf.indexAt(frames, -1)).toBe(0);
    expect(rf.indexAt(frames, 0)).toBe(1);
    expect(rf.indexAt(frames, 10)).toBe(3);
    expect(rf.indexAt(frames, 24.9)).toBe(3);
    expect(rf.indexAt(frames, 1000)).toBe(5);
    expect(rf.framesUpTo(frames, 25).map((f: { t: number }) => f.t)).toEqual([0, 10, 10, 25]);
  });

  it('paces playback by speed and chunks dense stretches', () => {
    expect(rf.playheadAt(0, 100, 1, 1000)).toBe(100);
    expect(rf.playheadAt(200, 100, 4, 1000)).toBe(600);
    expect(rf.playheadAt(200, 100, 16, 1000)).toBe(1000);
    expect(rf.playheadAt(0, 1, Infinity, 1000)).toBe(1000);
    expect(rf.SPEEDS).toEqual([1, 4, 16, Infinity]);

    const frames = [0, 5, 10, 15].map((t) => ({ t, sessionId: 'a', events: ev(3) }));
    expect(rf.nextChunk(frames, 0, 7, 100)).toEqual({ from: 0, to: 2, events: 6, done: false });
    expect(rf.nextChunk(frames, 0, 15, 7)).toEqual({ from: 0, to: 2, events: 6, done: false });
    // a single frame bigger than the cap still advances
    expect(rf.nextChunk(frames, 2, 15, 1)).toEqual({ from: 2, to: 3, events: 3, done: false });
    expect(rf.nextChunk(frames, 3, 15)).toEqual({ from: 3, to: 4, events: 3, done: true });
    expect(rf.nextChunk(frames, 1, 2)).toEqual({ from: 1, to: 1, events: 0, done: false });
  });

  it('rolling buffer evicts oldest whole frames past the event cap', () => {
    const buf = rf.createFrameBuffer(10);
    for (let i = 0; i < 6; i++) buf.push({ t: i, session: sess('a'), events: ev(3) });
    expect(buf.eventCount).toBeLessThanOrEqual(10);
    expect(buf.frames().map((f: { t: number }) => f.t)).toEqual([3, 4, 5]);
    // a single oversized frame is kept rather than dropping everything
    buf.push({ t: 9, session: sess('a'), events: ev(25) });
    expect(buf.frames().map((f: { t: number }) => f.t)).toEqual([9]);
    buf.clear();
    expect(buf.frameCount).toBe(0);
  });

  it('formats a playback clock', () => {
    expect(rf.fmtClock(0)).toBe('0:00.0');
    expect(rf.fmtClock(65_300)).toBe('1:05.3');
  });
});
