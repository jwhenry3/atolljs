/**
 * Dashboard commands for main-thread islands (`island.*` on the devtools
 * control channel). `mountIsland` registers each live handle here only
 * while devtools is enabled; `destroy()` drops it. Command names register
 * once and route by the `instance` arg.
 *
 * Only main-thread islands are commandable: a nested island's handle lives
 * in its parent's worker realm, which has no transport. Its DOM still
 * shows up, replayed into the outer island's container, so `island.tree`
 * on the outer instance includes it.
 */
import { registerDevtoolsCommand, previewValue } from '@atolljs/core';
import { isCallbackMarker } from './callbackProps';
import { jsonSafe, propsPreview } from './devtoolsPreview';
import type { IslandHandle, Mode } from './island';

export interface DevtoolsIslandEntry {
  handle: IslandHandle;
  /** The real container element the island replays into. */
  el: HTMLElement;
  /** The props as the caller last gave them (pre-marshal: markers intact). */
  props(): Record<string, unknown>;
}

const islands = new Map<string, DevtoolsIslandEntry>();
let commandsRegistered = false;

/** Track a mounted island for the dashboard; returns the untrack function. */
export const trackIslandForDevtools = (entry: DevtoolsIslandEntry): (() => void) => {
  ensureIslandCommands();
  const instance = entry.handle.instance;
  islands.set(instance, entry);
  return () => {
    if (islands.get(instance) === entry) islands.delete(instance);
    if (highlighted?.instance === instance) clearHighlight();
  };
};

const entryOf = (args: Record<string, unknown>): DevtoolsIslandEntry => {
  const instance = String(args.instance ?? '');
  const entry = islands.get(instance);
  if (entry) return entry;
  throw new Error(
    instance.includes('~')
      ? `island '${instance}' is nested: its handle lives in the parent worker, so it can't be commanded from the dashboard (inspect the outer island's tree instead)`
      : `island '${instance}' is not mounted on this page's main thread`,
  );
};

/* ── tree ────────────────────────────────────────────────────────────────── */

export interface IslandTreeNode {
  /** Child-index path from the container: '0', '0.2', '0.2.s' (shadow root). */
  id: string;
  /** Lowercase tag, or '#text' / '#shadow-root'. */
  tag: string;
  attrs: [string, string][];
  text?: string;
  children: IslandTreeNode[];
  /** Children omitted once the node budget ran out. */
  more?: number;
}

const TEXT_CAP = 200;
const ATTR_CAP = 200;

/** Children the tree shows: elements and non-blank text. Ids index this list. */
const visibleChildren = (n: Node): Node[] =>
  [...n.childNodes].filter((c) => c.nodeType === 1 || (c.nodeType === 3 && (c.nodeValue ?? '').trim() !== ''));

const shadowOf = (n: Node): ShadowRoot | null =>
  n.nodeType === 1 ? ((n as Element).shadowRoot ?? null) : null;

const cap = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

const serializeTree = (root: Element, maxNodes: number): { root: IslandTreeNode; count: number; truncated: boolean } => {
  let count = 0;
  let truncated = false;
  const walk = (n: Node, id: string): IslandTreeNode => {
    count++;
    if (n.nodeType === 3) {
      return { id, tag: '#text', attrs: [], text: cap(n.nodeValue ?? '', TEXT_CAP), children: [] };
    }
    const isShadow = n.nodeType === 11;
    const el = n as Element;
    const node: IslandTreeNode = {
      id,
      tag: isShadow ? '#shadow-root' : el.localName ?? el.nodeName.toLowerCase(),
      attrs: isShadow ? [] : [...el.attributes].map((a) => [a.name, cap(a.value, ATTR_CAP)]),
      children: [],
    };
    const kids: [Node, string][] = [];
    const shadow = shadowOf(n);
    if (shadow) kids.push([shadow, `${id}.s`]);
    visibleChildren(n).forEach((c, i) => kids.push([c, `${id}.${i}`]));
    for (let i = 0; i < kids.length; i++) {
      if (count >= maxNodes) {
        node.more = kids.length - i;
        truncated = true;
        break;
      }
      node.children.push(walk(kids[i][0], kids[i][1]));
    }
    return node;
  };
  return { root: walk(root, '0'), count, truncated };
};

/** Resolve a tree id back to its live node (same child filter as serialize). */
const resolveId = (root: Element, id: string): Node | null => {
  const parts = id.split('.');
  if (parts[0] !== '0') return null;
  let n: Node | null = root;
  for (const p of parts.slice(1)) {
    if (!n) return null;
    n = p === 's' ? shadowOf(n) : (visibleChildren(n)[Number(p)] ?? null);
  }
  return n;
};

/* ── highlight overlay ───────────────────────────────────────────────────── */

let overlay: HTMLDivElement | null = null;
let overlayLabel: HTMLSpanElement | null = null;
let highlighted: { instance: string } | null = null;

const rectOf = (n: Node): DOMRect | null => {
  if (n.nodeType === 1) return (n as Element).getBoundingClientRect();
  if (n.nodeType === 11) return ((n as ShadowRoot).host as Element | undefined)?.getBoundingClientRect() ?? null;
  if (n.nodeType === 3) {
    const range = n.ownerDocument?.createRange();
    if (!range) return null;
    range.selectNodeContents(n);
    return range.getBoundingClientRect();
  }
  return null;
};

const tagOf = (n: Node): string =>
  n.nodeType === 3 ? '#text' : n.nodeType === 11 ? '#shadow-root' : (n as Element).localName;

const clearHighlight = (): void => {
  highlighted = null;
  if (overlay) overlay.style.display = 'none';
};

const showHighlight = (instance: string, doc: Document, target: Node): { x: number; y: number; w: number; h: number } | null => {
  const r = rectOf(target);
  if (!r) return null;
  if (!overlay || overlay.ownerDocument !== doc || !overlay.isConnected) {
    overlay?.remove();
    overlay = doc.createElement('div');
    overlay.setAttribute('data-atoll-devtools', 'highlight');
    overlay.style.cssText =
      'position:fixed;pointer-events:none;z-index:2147483647;box-sizing:border-box;' +
      'outline:2px solid #58a6ff;background:rgba(88,166,255,.18);display:none';
    overlayLabel = doc.createElement('span');
    overlayLabel.style.cssText =
      'position:absolute;left:0;white-space:nowrap;font:11px/16px ui-monospace,monospace;' +
      'padding:0 5px;border-radius:3px;background:#1f6feb;color:#fff';
    overlay.appendChild(overlayLabel);
    (doc.body ?? doc.documentElement).appendChild(overlay);
  }
  overlay.style.left = `${r.left}px`;
  overlay.style.top = `${r.top}px`;
  overlay.style.width = `${r.width}px`;
  overlay.style.height = `${r.height}px`;
  overlay.style.display = 'block';
  if (overlayLabel) {
    overlayLabel.textContent = `${tagOf(target)} ${Math.round(r.width)}×${Math.round(r.height)}`;
    overlayLabel.style.top = r.top >= 18 ? '-18px' : '100%';
  }
  highlighted = { instance };
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

/* ── props ───────────────────────────────────────────────────────────────── */

/**
 * Dashboard props are JSON: a '[fn]' placeholder (what `island.props`
 * shows for a callback) can't carry the function back. Restore it from the
 * current props at the same path so a read-edit-write round trip keeps
 * the island's callbacks wired.
 */
const restoreFns = (next: unknown, current: unknown): unknown => {
  if (next === '[fn]' && (typeof current === 'function' || isCallbackMarker(current))) return current;
  if (Array.isArray(next)) {
    return next.map((v, i) => restoreFns(v, Array.isArray(current) ? current[i] : undefined));
  }
  if (next !== null && typeof next === 'object') {
    const cur = current !== null && typeof current === 'object' ? (current as Record<string, unknown>) : {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(next)) out[k] = restoreFns(v, cur[k]);
    return out;
  }
  return next;
};

/* ── registration ────────────────────────────────────────────────────────── */

const ensureIslandCommands = (): void => {
  if (commandsRegistered) return;
  commandsRegistered = true;

  registerDevtoolsCommand('island.list', () =>
    [...islands.values()].map(({ handle }) => ({
      instance: handle.instance,
      app: handle.app,
      pid: handle.pid,
      mode: handle.mode,
    })),
  );

  registerDevtoolsCommand('island.tree', (args) => {
    const { el } = entryOf(args);
    const max = Math.min(Math.max(Number(args.maxNodes) || 3000, 1), 20000);
    return serializeTree(el, max);
  });

  registerDevtoolsCommand('island.highlight', (args) => {
    const entry = entryOf(args);
    if (args.id === null || args.id === undefined) {
      clearHighlight();
      return { ok: true };
    }
    const target = resolveId(entry.el, String(args.id));
    if (!target) {
      clearHighlight();
      return { ok: false };
    }
    const rect = showHighlight(entry.handle.instance, entry.el.ownerDocument, target);
    return { ok: rect !== null, rect };
  });

  registerDevtoolsCommand('island.props', (args) => {
    const raw = entryOf(args).props();
    return { props: jsonSafe(raw), preview: propsPreview(raw) };
  });

  registerDevtoolsCommand('island.updateProps', async (args) => {
    const entry = entryOf(args);
    const next = args.props;
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      throw new Error('island.updateProps: `props` must be an object');
    }
    const restored = restoreFns(next, entry.props()) as Record<string, unknown>;
    await entry.handle.updateProps(restored);
    return { ok: true, preview: previewValue(jsonSafe(restored), 4096) };
  });

  registerDevtoolsCommand('island.setMode', (args) => {
    const { handle } = entryOf(args);
    const mode = args.mode;
    if (mode !== 'push' && mode !== 'poll') throw new Error("island.setMode: mode must be 'push' or 'poll'");
    handle.setMode(mode as Mode);
    return { mode: handle.mode };
  });
};
