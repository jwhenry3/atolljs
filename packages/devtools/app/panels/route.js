// Pure helpers for the dashboard shell (panels/shell.js): hash routes,
// palette fuzzy matching, `g <letter>` view resolution, nav overflow math.
// No DOM access here, so test/route.test.ts can exercise everything.

/** Query params a route may carry, in the order formatRoute writes them. */
export const ROUTE_PARAMS = ['session', 'island', 'worker'];

// `|` and `@` are legal in a fragment and keep island/worker keys readable
// (`island=s1|nested@1`); everything else goes through encodeURIComponent.
const enc = (v) => encodeURIComponent(v).replace(/%7C/gi, '|').replace(/%40/g, '@');
const dec = (v) => {
  try { return decodeURIComponent(v); } catch { return v; }
};

/**
 * `#/<view>[/<sub>][?session=…&island=…&worker=…]` → { view, sub, params },
 * or null when the hash isn't a route. Unknown params are kept.
 */
export function parseRoute(hash) {
  if (typeof hash !== 'string') return null;
  const h = hash.replace(/^#/, '');
  if (!h.startsWith('/')) return null;
  const q = h.indexOf('?');
  const path = q >= 0 ? h.slice(1, q) : h.slice(1);
  const [view, sub] = path.split('/').filter(Boolean).map(dec);
  if (!view) return null;
  const params = {};
  if (q >= 0) {
    for (const pair of h.slice(q + 1).split('&')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      const k = dec(eq >= 0 ? pair.slice(0, eq) : pair);
      if (k) params[k] = eq >= 0 ? dec(pair.slice(eq + 1)) : '';
    }
  }
  return { view, sub: sub ?? null, params };
}

/** Inverse of parseRoute. Empty/nullish params are dropped. */
export function formatRoute({ view, sub = null, params = {} }) {
  let s = `#/${enc(view)}${sub ? `/${enc(sub)}` : ''}`;
  const keys = [
    ...ROUTE_PARAMS.filter((k) => k in params),
    ...Object.keys(params).filter((k) => !ROUTE_PARAMS.includes(k)).sort(),
  ];
  const qs = keys
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .map((k) => `${enc(k)}=${enc(String(params[k]))}`);
  return qs.length ? `${s}?${qs.join('&')}` : s;
}

/** Dashboard state keys are `${session}|…`: the part after the session. */
export const keyTail = (k) => {
  const i = k.indexOf('|');
  return i >= 0 ? k.slice(i + 1) : k;
};

/**
 * Resolve a routed entity key against the live key set: exact match first
 * (same session still around), else the same tail in another session
 * (the app reloaded and got a new session id), preferring live ones.
 */
export function resolveKey(keys, want, isLive = () => true) {
  if (!want) return null;
  const all = [...keys];
  if (all.includes(want)) return want;
  const tail = keyTail(want);
  const same = all.filter((k) => keyTail(k) === tail);
  return same.find(isLive) ?? same[0] ?? null;
}

/* ── fuzzy matching ─────────────────────────────────────────────────────── */

const SEP = /[\s\-_/|@#~.:›,()[\]]/;
const isBoundary = (text, i) =>
  i === 0 || SEP.test(text[i - 1]) ||
  (text[i] >= 'A' && text[i] <= 'Z' && text[i - 1] >= 'a' && text[i - 1] <= 'z');

/**
 * Score `query` against `text` (case-insensitive). Substring hits beat
 * scattered subsequences; prefix and word-boundary hits score higher.
 * Returns { score, idx } (matched char indices, for highlighting) or null.
 */
export function fuzzyMatch(query, text) {
  const q = String(query ?? '').trim().toLowerCase();
  const raw = String(text ?? '');
  if (!q) return { score: 0, idx: [] };
  const t = raw.toLowerCase();
  const at = t.indexOf(q);
  if (at >= 0) {
    // prefer a boundary occurrence if there is one later in the string
    let best = at;
    for (let i = at; i >= 0; i = t.indexOf(q, i + 1)) {
      if (isBoundary(raw, i)) { best = i; break; }
    }
    const score = 100 + (best === 0 ? 40 : 0) + (isBoundary(raw, best) ? 25 : 0)
      - best * 0.5 - (t.length - q.length) * 0.05;
    return { score, idx: Array.from({ length: q.length }, (_, k) => best + k) };
  }
  const idx = [];
  let score = 0;
  let ti = 0;
  for (const c of q) {
    if (c === ' ') continue;
    // prefer the next boundary occurrence of c, else the next occurrence
    let hit = -1;
    for (let i = ti; i < t.length; i++) {
      if (t[i] !== c) continue;
      if (hit < 0) hit = i;
      if (isBoundary(raw, i)) { hit = i; break; }
      // don't skip far ahead hunting for a boundary
      if (i - hit > 8) break;
    }
    if (hit < 0) return null;
    const prev = idx[idx.length - 1];
    score += 10;
    if (prev !== undefined && hit === prev + 1) score += 8;
    if (isBoundary(raw, hit)) score += 6;
    if (prev !== undefined) score -= Math.min(10, (hit - prev - 1) * 0.5);
    idx.push(hit);
    ti = hit + 1;
  }
  return { score: score - (t.length - idx.length) * 0.05, idx };
}

/**
 * Rank palette items `{ title, group?, hint?, keywords? }`. Every
 * whitespace-separated token must match the title or (at a discount) the
 * group/hint/keywords. Highlight indices come from title matches only.
 * Returns [{ item, score, idx }] best first; an empty query keeps order.
 */
export function rankItems(query, items) {
  const tokens = String(query ?? '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return items.map((item) => ({ item, score: 0, idx: [] }));
  const out = [];
  for (const item of items) {
    const title = String(item.title ?? '');
    const extra = [item.group, item.hint, item.keywords].filter(Boolean).join(' ');
    let score = 0;
    const idx = [];
    let ok = true;
    // whole-query title match first: "js heap" should light up "JS heap"
    const whole = tokens.length > 1 ? fuzzyMatch(tokens.join(' '), title) : null;
    if (whole && whole.score >= 100) {
      out.push({ item, score: whole.score * tokens.length, idx: whole.idx });
      continue;
    }
    for (const tok of tokens) {
      const m = fuzzyMatch(tok, title);
      const e = extra ? fuzzyMatch(tok, extra) : null;
      if (m && (!e || m.score >= e.score * 0.5)) { score += m.score; idx.push(...m.idx); }
      else if (e) score += e.score * 0.5;
      else { ok = false; break; }
    }
    if (ok) out.push({ item, score, idx: [...new Set(idx)].sort((a, b) => a - b) });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Bucket ranked results by `item.group`. Groups listed in `order` come in
 * that order when the query is empty; with a query, groups sort by their
 * best hit. `perGroup` caps each bucket.
 */
export function groupResults(ranked, { order = [], perGroup = Infinity, byScore = false } = {}) {
  const groups = new Map();
  for (const r of ranked) {
    const g = r.item.group ?? 'Commands';
    if (!groups.has(g)) groups.set(g, []);
    const list = groups.get(g);
    if (list.length < perGroup) list.push(r);
  }
  const rank = (g) => {
    const i = order.indexOf(g);
    return i >= 0 ? i : order.length;
  };
  return [...groups.entries()]
    .map(([group, items]) => ({ group, items }))
    .sort((a, b) =>
      byScore
        ? b.items[0].score - a.items[0].score || rank(a.group) - rank(b.group)
        : rank(a.group) - rank(b.group));
}

/* ── keyboard ───────────────────────────────────────────────────────────── */

/** `g <letter>` → the view it names (only when that view exists). */
export const G_VIEWS = {
  d: 'dashboard',
  p: 'performance',
  t: 'tasks',
  n: 'network',
  m: 'memory',
  r: 'reactivity',
  a: 'audits',
  l: 'log',
};

/**
 * Resolve a `g` letter against registered views `[{ id, label }]`: the
 * G_VIEWS name by id, then by id/label prefix (panels may name their view
 * `perf` or label it "Performance"). Unmapped letters fall back to the
 * first view whose label starts with that letter.
 */
export function viewForLetter(letter, views) {
  const l = String(letter ?? '').toLowerCase();
  if (!/^[a-z]$/.test(l)) return null;
  const name = G_VIEWS[l];
  if (name) {
    const stem = name.slice(0, 4);
    const v = views.find((x) => x.id === name) ??
      views.find((x) => x.id.toLowerCase().startsWith(stem)) ??
      views.find((x) => String(x.label ?? '').toLowerCase().startsWith(stem));
    return v ? v.id : null;
  }
  const v = views.find((x) => String(x.label ?? x.id).toLowerCase().startsWith(l));
  return v ? v.id : null;
}

/** The letter `g <letter>` uses for a view id, or null. */
export function letterForView(id, views) {
  for (const l of Object.keys(G_VIEWS)) if (viewForLetter(l, views) === id) return l;
  const v = views.find((x) => x.id === id);
  const first = String(v?.label ?? id).toLowerCase()[0];
  return first && viewForLetter(first, views) === id ? first : null;
}

/** True when a keystroke belongs to a text field, not to shortcuts. */
export function isTypingTarget(el) {
  if (!el || typeof el !== 'object') return false;
  const tag = String(el.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = String(el.type ?? 'text').toLowerCase();
    return !['button', 'checkbox', 'radio', 'range', 'color', 'submit', 'reset', 'file', 'image'].includes(type);
  }
  return el.isContentEditable === true;
}

/* ── nav overflow ───────────────────────────────────────────────────────── */

/**
 * Which nav buttons to fold into the "More" menu. `widths` in nav order,
 * `avail` the nav's width, `active` the selected index (always kept
 * visible), `moreW` the More button's width. Keeps a contiguous prefix
 * plus the active tab. Returns the hidden indices, ascending.
 */
export function layoutNav(widths, avail, active, moreW) {
  const total = widths.reduce((a, w) => a + w, 0);
  if (total <= avail) return [];
  let budget = avail - moreW;
  const keep = new Set();
  if (active >= 0 && active < widths.length) {
    keep.add(active);
    budget -= widths[active];
  }
  for (let i = 0; i < widths.length; i++) {
    if (i === active) continue;
    if (widths[i] > budget) break;
    keep.add(i);
    budget -= widths[i];
  }
  return widths.map((_, i) => i).filter((i) => !keep.has(i));
}
