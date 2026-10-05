// Record / export / import / replay. Every received batch lands in a
// bounded rolling capture; ● Rec marks an explicit recording. Export writes
// the recording when there is one, else the rolling buffer. Import pauses
// the live transport (api.livePaused), resets the dashboard, and re-ingests
// the file's frames through api.ingest under closed '⏺ ' sessions, so the
// views rebuild exactly as they did live and no control command can fire.
// File format and pacing math: recording-format.js.

import {
  SPEEDS, countEvents, createFrameBuffer, fmtClock, indexAt, nextChunk, playheadAt,
  recordingDuration, recordingFileName, replaySessions, serializeRecording, validateRecording,
} from './recording-format.js';
import { toast } from './toast.js';

const ROLLING_EVENTS = 50_000;
const RECORDING_EVENTS = 500_000;
/** Seek ingests synchronously; chunk it only to keep one step from stalling. */
const PLAY_CHUNK_EVENTS = 2000;

const CSS = `
#rec-banner { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin:0 0 10px; padding:6px 10px;
  border:1px solid #d2992266; border-left:4px solid #d29922; border-radius:6px; background:#1f1a0e; font-size:12px; }
#rec-banner b { color:#e3b341; }
#rec-banner .meta { color:#8b949e; }
#rec-banner input[type=range] { flex:1 1 220px; min-width:160px; accent-color:#d29922; }
#rec-banner select { background:#0d1117; color:#c9d1d9; border:1px solid #30363d; border-radius:4px; font:inherit; }
#rec-banner .clock { font-variant-numeric:tabular-nums; color:#c9d1d9; min-width:96px; }
#rec-drop { position:fixed; inset:0; z-index:9998; display:none; align-items:center; justify-content:center;
  background:#010409cc; color:#e6edf3; font:600 18px system-ui,sans-serif; border:3px dashed #58a6ff; }
body.rec-dragging #rec-drop { display:flex; }
button.act.rec-on { border-color:#f85149; color:#ff7b72; }
`;

export function setup(api) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  /* ── capture ──────────────────────────────────────────────────────────── */

  const rolling = createFrameBuffer(ROLLING_EVENTS);
  /** Explicit recording: { frames, events, active, capped } or null. */
  let rec = null;
  /** True while this panel itself is feeding api.ingest (replay/seek). */
  let feeding = false;

  api.onBatch((session, events) => {
    if (feeding || api.livePaused || !events.length) return;
    const frame = { t: performance.now(), session, events };
    rolling.push(frame);
    if (rec?.active) {
      if (rec.events + events.length > RECORDING_EVENTS) {
        if (!rec.capped) toast(`Recording hit ${RECORDING_EVENTS.toLocaleString()} events: stopped`, 'info');
        rec.capped = true;
        stopRec();
        return;
      }
      rec.frames.push(frame);
      rec.events += events.length;
    }
  });

  /* ── toolbar ──────────────────────────────────────────────────────────── */

  const recBtn = api.addToolbarButton({
    id: 'rec-toggle', label: '● Rec', order: 20,
    title: 'Start an explicit recording (Export then saves just the recording)',
    onClick: () => (rec?.active ? stopRec() : startRec()),
  });
  const exportBtn = api.addToolbarButton({
    id: 'rec-export', label: 'Export', order: 21,
    title: 'Download the recording, or the rolling capture of recent frames',
    onClick: () => exportFrames(),
  });
  api.addToolbarButton({
    id: 'rec-import', label: 'Import', order: 22,
    title: 'Open a recording (.json) for replay; you can also drop the file on the window',
    onClick: () => picker.click(),
  });

  const syncButtons = () => {
    recBtn.innerHTML = rec?.active ? '■ Stop' : '● Rec';
    recBtn.classList.toggle('rec-on', !!rec?.active);
    recBtn.title = rec?.active
      ? `Recording: ${rec.events.toLocaleString()} events so far (click to stop)`
      : 'Start an explicit recording (Export then saves just the recording)';
    exportBtn.innerHTML = rec?.frames.length ? 'Export rec' : 'Export';
  };

  function startRec() {
    if (api.livePaused) return toast('Go back to live before recording', 'info');
    rec = { frames: [], events: 0, active: true, capped: false };
    syncButtons();
    toast('Recording started', 'info');
  }

  function stopRec() {
    if (!rec) return;
    rec.active = false;
    syncButtons();
    toast(`Recording stopped: ${rec.events.toLocaleString()} events`);
  }

  api.onTick(() => { if (rec?.active) syncButtons(); });

  function download(name, data) {
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function exportFrames({ useRolling = false } = {}) {
    const fromRec = !useRolling && rec?.frames.length;
    const source = fromRec ? rec.frames : rolling.frames();
    const sid = api.state.sel && api.state.sessions.has(api.state.sel) ? api.state.sel : null;
    const data = serializeRecording(source, { sessionId: sid });
    if (!data.frames.length) return toast('Nothing captured yet', 'info');
    const name = sid ? (api.state.sessions.get(sid)?.name ?? sid) : null;
    download(recordingFileName(name), data);
    toast(`Exported ${countEvents(data.frames).toLocaleString()} events${fromRec ? ' (recording)' : ''}`);
  }

  /* ── import ───────────────────────────────────────────────────────────── */

  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = '.json,application/json';
  picker.style.display = 'none';
  picker.onchange = () => {
    const f = picker.files?.[0];
    picker.value = '';
    if (f) importFile(f);
  };
  document.body.appendChild(picker);

  const drop = document.createElement('div');
  drop.id = 'rec-drop';
  drop.textContent = 'Drop an atoll devtools recording to replay it';
  document.body.appendChild(drop);
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    dragDepth++;
    document.body.classList.add('rec-dragging');
  });
  window.addEventListener('dragleave', () => {
    if (dragDepth && --dragDepth === 0) document.body.classList.remove('rec-dragging');
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('rec-dragging');
    const f = [...e.dataTransfer.files].find((x) => /\.json$/i.test(x.name) || x.type === 'application/json');
    if (f) importFile(f);
    else toast('Drop a .json recording', 'error');
  });

  async function importFile(file) {
    let recording;
    try {
      recording = validateRecording(JSON.parse(await file.text()));
    } catch (err) {
      return toast(`Import failed: ${err.message}`, 'error');
    }
    if (rec?.active) stopRec();
    startReplay(recording, file.name);
  }

  /* ── replay ───────────────────────────────────────────────────────────── */

  /** { frames, sessions, name, duration, events, cursor, playhead, playing, speed, wallStart, fromMs, timer, els } */
  let rp = null;

  function startReplay(recording, name) {
    stopPlayback();
    api.livePaused = true;
    const frames = recording.frames;
    rp = {
      frames,
      sessions: replaySessions(recording),
      name,
      duration: recordingDuration(frames),
      events: countEvents(frames),
      cursor: 0,
      playhead: 0,
      playing: false,
      speed: 1,
      timer: 0,
      els: null,
    };
    buildBanner();
    seek(rp.duration); // the full picture first; Play restarts from 0
    toast(`Loaded ${name}: ${rp.events.toLocaleString()} events`);
  }

  /** Feed frames [rp.cursor, to) into the dashboard. */
  function feed(to) {
    feeding = true;
    try {
      for (let i = rp.cursor; i < to; i++) {
        const f = rp.frames[i];
        api.ingest(rp.sessions.get(f.sessionId), f.events);
      }
    } finally {
      feeding = false;
    }
    rp.cursor = to;
  }

  /** Jump to recording time `at`: reset, then re-ingest everything up to it. */
  function seek(at) {
    rp.seeking = true;
    try {
      api.reset();
    } finally {
      rp.seeking = false;
    }
    rp.cursor = 0;
    rp.playhead = Math.max(0, Math.min(at, rp.duration));
    feed(indexAt(rp.frames, rp.playhead));
    syncBanner();
  }

  function play() {
    if (!rp) return;
    if (rp.cursor >= rp.frames.length) seek(0);
    rp.playing = true;
    rp.fromMs = rp.playhead;
    rp.wallStart = performance.now();
    step();
    syncBanner();
  }

  function stopPlayback() {
    if (!rp) return;
    rp.playing = false;
    clearTimeout(rp.timer);
    syncBanner();
  }

  function step() {
    if (!rp?.playing) return;
    const target = playheadAt(rp.fromMs, performance.now() - rp.wallStart, rp.speed, rp.duration);
    const chunk = nextChunk(rp.frames, rp.cursor, target, PLAY_CHUNK_EVENTS);
    feed(chunk.to);
    // A capped chunk lags the wall clock: the playhead is what was ingested.
    rp.playhead = chunk.to < indexAt(rp.frames, target) ? rp.frames[chunk.to - 1]?.t ?? target : target;
    if (chunk.done && rp.playhead >= rp.duration) {
      rp.playhead = rp.duration;
      rp.playing = false;
      syncBanner();
      return;
    }
    syncBanner();
    rp.timer = setTimeout(step, rp.speed === Infinity ? 0 : 33);
  }

  function setSpeed(speed) {
    if (!rp) return;
    if (rp.playing) {
      rp.fromMs = rp.playhead;
      rp.wallStart = performance.now();
    }
    rp.speed = speed;
  }

  function backToLive() {
    stopPlayback();
    rp?.els?.banner.remove();
    rp = null;
    api.reset();
    api.livePaused = false;
    api.reannounce();
    toast('Back to live', 'info');
  }

  function buildBanner() {
    document.getElementById('rec-banner')?.remove();
    const banner = document.createElement('div');
    banner.id = 'rec-banner';
    banner.innerHTML = `
      <span>⏺ Replay <b></b></span>
      <span class="meta"></span>
      <button class="act" data-r="play">▶ Play</button>
      <select data-r="speed" title="Playback speed">${SPEEDS.map((s) => `<option value="${s}">${s === Infinity ? 'max' : `${s}x`}</option>`).join('')}</select>
      <input type="range" data-r="scrub" min="0" step="1" title="Seek: rebuilds the dashboard up to this point">
      <span class="clock"></span>
      <button class="act" data-r="live" title="Discard the replay and reconnect to live apps">Back to live</button>`;
    const q = (r) => banner.querySelector(`[data-r="${r}"]`);
    const els = { banner, name: banner.querySelector('b'), meta: banner.querySelector('.meta'), play: q('play'), speed: q('speed'), scrub: q('scrub'), clock: banner.querySelector('.clock'), live: q('live') };
    els.name.textContent = rp.name;
    els.meta.textContent = `${fmtClock(rp.duration)} · ${rp.events.toLocaleString()} events · ${rp.sessions.size} session(s)`;
    els.scrub.max = String(Math.max(1, Math.ceil(rp.duration)));
    els.play.onclick = () => (rp.playing ? stopPlayback() : play());
    els.speed.onchange = () => setSpeed(Number(els.speed.value));
    els.scrub.oninput = () => { els.clock.textContent = `${fmtClock(Number(els.scrub.value))} / ${fmtClock(rp.duration)}`; };
    els.scrub.onchange = () => {
      const wasPlaying = rp.playing;
      stopPlayback();
      seek(Number(els.scrub.value));
      if (wasPlaying) play();
    };
    els.live.onclick = backToLive;
    rp.els = els;
    const panels = document.querySelector('.panels');
    if (panels) panels.prepend(banner);
    else document.body.prepend(banner);
  }

  function syncBanner() {
    const els = rp?.els;
    if (!els) return;
    els.play.textContent = rp.playing ? '❚❚ Pause' : '▶ Play';
    if (document.activeElement !== els.scrub) els.scrub.value = String(Math.round(rp.playhead));
    els.clock.textContent = `${fmtClock(rp.playhead)} / ${fmtClock(rp.duration)}`;
  }

  // An outside reset (not our seek) while replaying keeps the replay but
  // rewinds its cursor so the next Play/seek re-ingests from a clean slate.
  api.onReset(() => {
    if (rp && !rp.seeking) {
      rp.cursor = 0;
      rp.playhead = 0;
      stopPlayback();
    }
  });

  /* ── palette ──────────────────────────────────────────────────────────── */

  api.addPaletteItem({ id: 'recorder.toggle', title: 'Recording: start / stop', group: 'Recorder', run: () => (rec?.active ? stopRec() : startRec()) });
  api.addPaletteItem({ id: 'recorder.export', title: 'Export recording', group: 'Recorder', hint: 'The explicit recording when there is one, else the rolling capture', run: () => exportFrames() });
  api.addPaletteItem({ id: 'recorder.export-rolling', title: 'Export rolling capture', group: 'Recorder', hint: `The last ~${ROLLING_EVENTS.toLocaleString()} received events`, run: () => exportFrames({ useRolling: true }) });
  api.addPaletteItem({ id: 'recorder.discard', title: 'Discard recording', group: 'Recorder', run: () => { rec = null; syncButtons(); toast('Recording discarded', 'info'); } });
  api.addPaletteItem({ id: 'recorder.import', title: 'Import recording…', group: 'Recorder', run: () => picker.click() });
  api.addPaletteItem({ id: 'recorder.live', title: 'Replay: back to live', group: 'Recorder', run: () => { if (rp) backToLive(); else toast('Not replaying', 'info'); } });
}
