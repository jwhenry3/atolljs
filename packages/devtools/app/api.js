// Panel plugin API for the devtools dashboard.
//
// main.js owns the event reducer, the core views, and the transport; every
// feature panel lives in app/panels/<name>.js, exports `setup(api)`, and is
// listed in PANELS in main.js. Panels never edit main.js state shapes —
// they keep their own state, fed by the hooks below.
//
// Rendering contract: hooks.render / inspector hooks run on EVERY render()
// (rAF-batched, many times a second under load). A panel that owns inputs
// (editors, filters) must not rebuild them each call: build once, then
// update text/values in place, or re-render only when its own key changes.

export const api = {
  // ── hooks (panels push callbacks; main.js calls them) ───────────────────
  hooks: {
    /** (session, event) for every ingested event, after the core reducer. */
    event: [],
    /** (session, events) once per ingested batch — the recorder taps this. */
    batch: [],
    /** (liveSessionIds: Set) after the session list changes. */
    reconcile: [],
    /** () at the end of every render(). */
    render: [],
    /** () once a second (charts that roll with time). */
    tick: [],
    /** () after reset() clears all dashboard state. */
    reset: [],
    /** (islandKey, island, { extra, actions }) while the island inspector shows. */
    inspectIsland: [],
    /** (workerKey, worker, { actions }) while the worker inspector shows. */
    inspectWorker: [],
  },
  onEvent(fn) { this.hooks.event.push(fn); },
  onBatch(fn) { this.hooks.batch.push(fn); },
  onReconcile(fn) { this.hooks.reconcile.push(fn); },
  onRender(fn) { this.hooks.render.push(fn); },
  onTick(fn) { this.hooks.tick.push(fn); },
  onReset(fn) { this.hooks.reset.push(fn); },
  onInspectIsland(fn) { this.hooks.inspectIsland.push(fn); },
  onInspectWorker(fn) { this.hooks.inspectWorker.push(fn); },

  // ── command palette registry (the palette UI reads this) ────────────────
  /** [{ id, title, group, hint?, keys?, run() }] */
  palette: [],
  /** Add (or replace by id) a palette entry. */
  addPaletteItem(item) {
    const i = this.palette.findIndex((p) => p.id === item.id);
    if (i >= 0) this.palette[i] = item; else this.palette.push(item);
  },

  // ── filled in by main.js before panels' setup() runs ────────────────────
  // state, $, esc, fmt, fmtBytes, fmtInt, key, sessOf, inSel, withGroups,
  // kpi(value, label, cls?), sparkline, drawLine, drawMultiLine, fwIconImg,
  // render(), scheduleRender(),
  // addView({ id, label, order?, html, badge?, title? }) → section element,
  // addSubview(viewId, { id, label, html, order? }) → div element,
  // openView(viewId), openSub(viewId, subId),
  // control(sessionId, cmd, args?, timeoutMs?) → Promise<result>,
  // hasCommand(sessionId, cmd) → boolean (cached 'devtools.commands'),
  // liveSessions() → SessionInfo[], selectedOrOnlyLive() → sessionId | null,
  // ingest(session, events), reset(), reannounce(), isMini,
  // livePaused (true drops live transport frames: replay sets it),
  // addToolbarButton({ id, label, title?, order?, onClick }),
  // onNavigate(fn) (after openView / subtab changes), setViewIntro(viewId, html),
  // viewIntros, toast(msg, kind?, ms?),
  // transport ('broadcast' | 'extension' | 'ws': 'extension' is the Chrome
  // DevTools panel, broadcast semantics relayed from the inspected page).
};
