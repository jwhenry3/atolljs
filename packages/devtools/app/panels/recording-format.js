// Pure helpers for devtools recordings: the file format, validation, the
// bounded rolling capture, and replay pacing. No DOM, no api: recorder.js
// owns the UI; vitest imports this module directly.
//
// File shape (version 1):
//   { format: 'atoll-devtools-recording', version: 1, exportedAt,
//     sessions: SessionInfo[], frames: [{ t, sessionId, events }] }
// `t` is the dashboard's performance.now() at receipt; replay only uses
// differences, so recordings from any clock origin play back the same.

export const FORMAT = 'atoll-devtools-recording';
export const VERSION = 1;
/** Prefix marking replayed sessions in the dashboard. */
export const REPLAY_PREFIX = '⏺ ';
/** Playback speeds offered by the replay banner; Infinity = as fast as possible. */
export const SPEEDS = [1, 4, 16, Infinity];

/**
 * Bounded capture of received frames, evicting oldest whole frames once
 * the total event count passes `maxEvents`.
 */
export function createFrameBuffer(maxEvents = 50_000) {
  let frames = [];
  let head = 0;
  let events = 0;
  return {
    push(frame) {
      frames.push(frame);
      events += frame.events.length;
      while (events > maxEvents && head < frames.length - 1) {
        events -= frames[head].events.length;
        frames[head++] = undefined;
      }
      if (head > 1024 && head > frames.length / 2) {
        frames = frames.slice(head);
        head = 0;
      }
    },
    frames: () => frames.slice(head),
    get eventCount() { return events; },
    get frameCount() { return frames.length - head; },
    clear() { frames = []; head = 0; events = 0; },
  };
}

const pad = (n) => String(n).padStart(2, '0');

/** `atoll-devtools-<session-or-all>-<yyyymmdd-hhmmss>.json` (local time). */
export function recordingFileName(sessionName, date = new Date()) {
  const slug = (sessionName ?? 'all').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'session';
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `atoll-devtools-${slug}-${stamp}.json`;
}

/**
 * Build the export object from captured frames ({ t, session, events } as
 * the recorder holds them). `sessionId` narrows to one session.
 */
export function serializeRecording(captured, { sessionId = null, exportedAt = new Date().toISOString() } = {}) {
  const sessions = new Map();
  const frames = [];
  for (const f of captured) {
    if (sessionId && f.session.id !== sessionId) continue;
    sessions.set(f.session.id, f.session);
    frames.push({ t: f.t, sessionId: f.session.id, events: f.events });
  }
  return { format: FORMAT, version: VERSION, exportedAt, sessions: [...sessions.values()], frames };
}

/**
 * Validate a parsed file; returns the recording with frames sorted by `t`
 * and times rebased to start at 0. Throws an Error naming the first problem.
 */
export function validateRecording(data) {
  if (!data || typeof data !== 'object') throw new Error('not a JSON object');
  if (data.format !== FORMAT) throw new Error(`not an atoll devtools recording (format: ${JSON.stringify(data.format)})`);
  if (data.version !== VERSION) throw new Error(`unsupported recording version ${JSON.stringify(data.version)} (expected ${VERSION})`);
  if (!Array.isArray(data.sessions)) throw new Error('sessions must be an array');
  if (!Array.isArray(data.frames)) throw new Error('frames must be an array');
  for (const [i, s] of data.sessions.entries()) {
    if (!s || typeof s.id !== 'string') throw new Error(`sessions[${i}] has no string id`);
  }
  for (const [i, f] of data.frames.entries()) {
    if (!f || typeof f.t !== 'number' || !Number.isFinite(f.t)) throw new Error(`frames[${i}].t must be a finite number`);
    if (typeof f.sessionId !== 'string') throw new Error(`frames[${i}].sessionId must be a string`);
    if (!Array.isArray(f.events)) throw new Error(`frames[${i}].events must be an array`);
  }
  const sorted = data.frames.slice().sort((a, b) => a.t - b.t);
  const t0 = sorted.length ? sorted[0].t : 0;
  return {
    ...data,
    frames: sorted.map((f) => ({ t: f.t - t0, sessionId: f.sessionId, events: f.events })),
  };
}

/**
 * Sessions for replay, keyed by id: renamed with the replay prefix and
 * closed (the dashboard sends no control commands to closed sessions).
 * Frames naming an unlisted session get a stub entry.
 */
export function replaySessions(recording) {
  const out = new Map();
  for (const s of recording.sessions) {
    out.set(s.id, { ...s, name: `${REPLAY_PREFIX}${s.name ?? s.id}`, closed: true });
  }
  for (const f of recording.frames) {
    if (!out.has(f.sessionId)) {
      out.set(f.sessionId, { id: f.sessionId, name: `${REPLAY_PREFIX}${f.sessionId}`, runtime: 'browser', closed: true });
    }
  }
  return out;
}

/** Recording length in ms (frames rebased by validateRecording). */
export const recordingDuration = (frames) => (frames.length ? frames[frames.length - 1].t : 0);

export const countEvents = (frames) => frames.reduce((n, f) => n + f.events.length, 0);

/** Number of frames with `t <= at` — the replay cursor for a playhead (binary search). */
export function indexAt(frames, at) {
  let lo = 0;
  let hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= at) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Frames up to and including playhead `at`. */
export const framesUpTo = (frames, at) => frames.slice(0, indexAt(frames, at));

/**
 * Playhead for timed playback: recording ms reached after `wallMs` of
 * wall time at `speed`, starting from `fromMs`, clamped to `duration`.
 * Infinity speed jumps to the end (callers chunk the ingest instead).
 */
export function playheadAt(fromMs, wallMs, speed, duration) {
  if (speed === Infinity) return duration;
  return Math.min(duration, fromMs + Math.max(0, wallMs) * speed);
}

/**
 * The next slice to ingest during playback: frames [from, to) are due at
 * `playhead`, capped at `maxEvents` per step (at least one frame) so a dense
 * stretch or max speed never blocks the dashboard for long.
 */
export function nextChunk(frames, from, playhead, maxEvents = 2000) {
  const due = indexAt(frames, playhead);
  let to = from;
  let n = 0;
  while (to < due && (to === from || n + frames[to].events.length <= maxEvents)) {
    n += frames[to].events.length;
    to++;
  }
  return { from, to, events: n, done: to >= frames.length };
}

/** `1:05.3` style clock for the banner. */
export function fmtClock(ms) {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}
