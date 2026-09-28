import { parseDocument, ElementType } from 'htmlparser2';
import {
  allocId,
  bumpOpsVersion,
  getActiveRealm,
  getLastActiveRealm,
  getRealmSize,
  instances,
  markRealmActive,
  pushOp,
  registerHandler,
  unregisterHandler,
} from '../hostConfig';
import type { ElementInstance, HostInstance, TextInstance } from '../hostConfig';
import type { EventPayload, Op } from '../../ops';

import type { InternalDocument, ProxyDocument } from './document';


/** Handler signature for proxy addEventListener — the wire payload plus a
 *  synthesized `target` (the proxy node for `targetId`, when known). */
export type ProxyEventHandler = (payload: EventPayload) => void;

const hyphenate = (k: string): string => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const camelize = (k: string): string => k.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());

/**
 * Phantom instance ids — negative, so they can never collide with allocId's
 * positive ids and are never registered in `instances`. A phantom is the
 * synthetic text child an element's `textContent` setter leaves in the
 * shadow tree (the real DOM gets the same effect from `utext` on the
 * parent, which is why phantom mutations retarget the parent — see below).
 */
export let nextPhantomId = -1;
export const allocPhantomId = (): number => nextPhantomId--;

/**
 * A node that isn't a ProxyNode can only arrive via a foreign `document`
 * (the dispatcher's real-DOM fallback or a poisoned override) — typically a
 * library's deferred callback running after its realm was torn down, or
 * globals restored while worker-side timers still fire. Adopting it would
 * crash later on `child.instance`; reject it here with the actual cause.
 */
const rejectForeignChild = (child: unknown): never => {
  throw new Error(
    'proxyDom.insertBefore: child is not a proxy node — the ambient `document`/' +
      '`createElement` resolved a foreign DOM (a stale override or the real one), ' +
      'so this node was created outside the realm that owns the parent',
  );
};

/**
 * Detach `child` from its recorded parent, tolerating a stale/foreign
 * `_parent` link (undefined, or a non-proxy object) instead of crashing on
 * `_detach` — a corrupted link is cleared, a valid one is honored.
 */
const detachFromParent = (child: ProxyNode): void => {
  const p = child._parent;
  if (p instanceof ProxyNode) p._detach(child);
  else child._parent = null;
};

/* ── ProxyNode ─────────────────────────────────────────────────────────── */

export class ProxyNode {
  /** The shared host-instance record — same objects `instances` holds. */
  readonly instance: HostInstance;
  /** The document that created/wrapped this node (internal fields below). */
  readonly doc: InternalDocument;
  _parent: ProxyNode | null = null;
  _children: ProxyNode[] = [];

  constructor(doc: InternalDocument, instance: HostInstance) {
    this.doc = doc;
    this.instance = instance;
  }

  get nodeType(): number {
    return 0;
  }

  /** The proxy document that owns this node — what real DOM code reads as
   *  `el.ownerDocument`. */
  get ownerDocument(): ProxyDocument {
    return this.doc;
  }

  get parentNode(): ProxyNode | null {
    return this._parent;
  }
  get parentElement(): ProxyElement | null {
    return this._parent instanceof ProxyElement ? this._parent : null;
  }
  /** A copy of the shadow child list — structural changes go through
   *  appendChild/insertBefore/removeChild so ops stay in sync. */
  get childNodes(): ProxyNode[] {
    return this._children.slice();
  }
  get firstChild(): ProxyNode | null {
    return this._children[0] ?? null;
  }
  get lastChild(): ProxyNode | null {
    return this._children[this._children.length - 1] ?? null;
  }
  get nextSibling(): ProxyNode | null {
    const p = this._parent;
    if (p === null) return null;
    return p._children[p._children.indexOf(this) + 1] ?? null;
  }
  get previousSibling(): ProxyNode | null {
    const p = this._parent;
    if (p === null) return null;
    const i = p._children.indexOf(this);
    return i > 0 ? p._children[i - 1] : null;
  }
  /** Attached to the document's root (driver-side id 0 container)? */
  get isConnected(): boolean {
    let n: ProxyNode | null = this;
    while (n !== null) {
      if (n === this.doc._root) return true;
      n = n._parent;
    }
    return false;
  }

  /**
   * The topmost shadow-tree ancestor — the root container element when the
   * node is connected. (The facade has no separate Document node object;
   * `doc.body`/`documentElement` ARE that root.)
   */
  getRootNode(): ProxyNode {
    let n: ProxyNode = this;
    while (n._parent !== null) n = n._parent;
    return n;
  }

  /** Concatenated descendant text — walked from the shadow tree. */
  get textContent(): string {
    let out = '';
    for (const child of this._children) out += child.textContent;
    return out;
  }
  set textContent(value: string) {
    this.doc._assertAlive();
    const text = String(value);
    for (const child of this._children) child._parent = null;
    this._children = text === '' ? [] : [this.doc._phantomText(this, text)];
    this._op({ t: 'utext', id: this.instance.id, text });
  }

  contains(other: ProxyNode): boolean {
    let n: ProxyNode | null = other;
    while (n !== null) {
      if (n === this) return true;
      n = n._parent;
    }
    return false;
  }

  appendChild<T extends ProxyNode>(child: T): T {
    return this.insertBefore(child, null);
  }

  insertBefore<T extends ProxyNode>(child: T, ref: ProxyNode | null): T {
    this.doc._assertAlive();
    if (!(child instanceof ProxyNode)) rejectForeignChild(child);
    // A fragment is a phantom PARENT — the real DOM splices its children
    // in at the insertion point and empties it; do the same (per-child ops).
    if (child instanceof ProxyFragment) {
      for (const c of child._children.slice()) this.insertBefore(c, ref);
      return child;
    }
    let beforeId: number | undefined;
    if (ref === null) {
      detachFromParent(child);
      child._parent = this;
      this._children.push(child);
    } else {
      const index = this._children.indexOf(ref);
      if (index === -1) {
        throw new Error('proxyDom.insertBefore: reference node is not a child of this node');
      }
      detachFromParent(child);
      child._parent = this;
      this._children.splice(index, 0, child);
      if (ref.instance.id > 0) beforeId = ref.instance.id;
    }
    // Phantom nodes (fragments, shadow-only texts) have NEGATIVE ids and no
    // driver-side counterpart — skip ops when either endpoint is phantom.
    // Id 0 is NOT phantom: it's the island's real root container.
    if (this.instance.id >= 0 && child.instance.id > 0) {
      this._op({ t: 'append', parent: this.instance.id, child: child.instance.id, before: beforeId });
    }
    return child;
  }

  removeChild<T extends ProxyNode>(child: T): T {
    this.doc._assertAlive();
    const index = this._children.indexOf(child);
    if (index === -1) {
      throw new Error('proxyDom.removeChild: node is not a child of this node');
    }
    this._children.splice(index, 1);
    child._parent = null;
    if (this.instance.id >= 0 && child.instance.id > 0) {
      this._op({ t: 'remove', child: child.instance.id });
    }
    return child;
  }

  /** Detach from the parent — no-op when already orphaned (like the DOM). */
  remove(): void {
    this._parent?.removeChild(this);
  }

  /** The node's own line of markup — start tag, children, end tag. */
  get outerHTML(): string {
    return serializeNode(this);
  }

  /**
   * Queue an op on this node's realm — the same routing hostConfig uses for
   * instance-bound ops. Outside a realm task the op still lands on the right
   * queue, and the doorbell is bumped so push-mode islands pick it up.
   */
  _op(op: Op): void {
    pushOp(this.instance.realm, op);
    if (getActiveRealm() !== this.instance.realm) bumpOpsVersion();
  }

  /** Detach a child from the shadow list WITHOUT emitting an op — used when
   *  a following append op will move the real node on the main thread. */
  _detach(child: ProxyNode): void {
    const i = this._children.indexOf(child);
    if (i !== -1) this._children.splice(i, 1);
    child._parent = null;
  }
}

/* ── ProxyText ─────────────────────────────────────────────────────────── */

export class ProxyText extends ProxyNode {
  declare readonly instance: TextInstance;

  constructor(doc: InternalDocument, instance: TextInstance) {
    super(doc, instance);
  }

  override get nodeType(): number {
    return 3;
  }

  /**
   * The driver-side id a text write targets. Real text instances write
   * their own id; phantoms (created by an element's `textContent` setter)
   * have no driver-side node, so writes retarget the parent — whose real
   * `textContent` IS this node's whole text.
   */
  get _utextTarget(): number {
    return this.instance.id > 0
      ? this.instance.id
      : (this._parent?.instance.id ?? this.instance.id);
  }

  get data(): string {
    return this.instance.text;
  }
  set data(v: string) {
    this._write(v);
  }
  get nodeValue(): string {
    return this.instance.text;
  }
  set nodeValue(v: string) {
    this._write(v);
  }
  override get textContent(): string {
    return this.instance.text;
  }
  override set textContent(v: string) {
    this._write(v);
  }

  private _write(v: string): void {
    this.doc._assertAlive();
    const text = String(v);
    this.instance.text = text;
    this._op({ t: 'utext', id: this._utextTarget, text });
  }
}

/* ── ProxyFragment ─────────────────────────────────────────────────────── */

/**
 * DocumentFragment — a PHANTOM parent: it never exists driver-side, so its
 * `instance.id` is negative (no ops ever target it). Appending it to a real
 * parent splices its children out like the DOM does; libraries use it to
 * batch insertions (Leaflet's GridLayer builds each zoom level in one).
 */
export class ProxyFragment extends ProxyNode {
  override get nodeType(): number {
    return 11;
  }
}

/* ── ProxyElement ──────────────────────────────────────────────────────── */

export interface ProxyClassList {
  add(...tokens: string[]): void;
  remove(...tokens: string[]): void;
  toggle(token: string, force?: boolean): boolean;
  contains(token: string): boolean;
  readonly value: string;
}

/** Positions `insertAdjacentHTML`/`insertAdjacentElement` accept. */
export type AdjacentPosition = 'beforebegin' | 'afterbegin' | 'beforeend' | 'afterend';

export class ProxyElement extends ProxyNode {
  declare readonly instance: ElementInstance;
  readonly _attrs = new Map<string, string>();
  _classes = new Set<string>();
  readonly _styleProps: Record<string, string> = {};
  private _styleObj: Record<string, unknown> | null = null;
  private _datasetObj: Record<string, string> | null = null;
  private _classListObj: ProxyClassList | null = null;
  private readonly _listeners: Array<{ type: string; fn: ProxyEventHandler; hid: number }> = [];

  override get nodeType(): number {
    return 1;
  }
  get tagName(): string {
    return this.instance.type.toUpperCase();
  }
  /** Element children only — the shadow tree's HTMLCollection equivalent. */
  get children(): ProxyElement[] {
    return this._children.filter((c): c is ProxyElement => c instanceof ProxyElement);
  }

  get id(): string {
    return this._attrs.get('id') ?? '';
  }
  set id(v: string) {
    this._setAttr('id', v);
  }
  get className(): string {
    return this._attrs.get('class') ?? '';
  }
  set className(v: string) {
    this._setAttr('class', v);
  }

  getAttribute(name: string): string | null {
    return this._attrs.get(name) ?? null;
  }
  hasAttribute(name: string): boolean {
    return this._attrs.has(name);
  }
  setAttribute(name: string, value: string): void {
    this._setAttr(name, value);
  }
  removeAttribute(name: string): void {
    this.doc._assertAlive();
    if (!this._attrs.has(name)) return;
    this._attrs.delete(name);
    this._afterAttrChange(name);
    this._op({ t: 'attr', id: this.instance.id, name, value: null });
  }

  /* classList — a live view over _classes synced to the `class` attr. */
  get classList(): ProxyClassList {
    if (this._classListObj === null) {
      const el = this;
      this._classListObj = {
        add: (...tokens) => {
          let changed = false;
          for (const t of tokens) {
            if (t !== '' && !el._classes.has(t)) {
              el._classes.add(t);
              changed = true;
            }
          }
          if (changed) el._syncClasses();
        },
        remove: (...tokens) => {
          let changed = false;
          for (const t of tokens) changed = el._classes.delete(t) || changed;
          if (changed) el._syncClasses();
        },
        toggle: (token, force) => {
          const has = el._classes.has(token);
          const want = force ?? !has;
          if (want === has) return has;
          if (want) el._classes.add(token);
          else el._classes.delete(token);
          el._syncClasses();
          return want;
        },
        contains: (token) => el._classes.has(token),
        get value() {
          return el._attrs.get('class') ?? '';
        },
      };
    }
    return this._classListObj;
  }

  /**
   * Inline style — a Proxy over a plain prop record. Writes re-send only
   * the changed key; `delete style.x`/`style.removeProperty('x')` send ''
   * (the protocol's "clear this key"). `setProperty`/`getPropertyValue`
   * accept kebab-case and camelize it, like the real CSSStyleDeclaration.
   */
  get style(): CSSStyleDeclaration {
    if (this._styleObj === null) {
      const el = this;
      this._styleObj = new Proxy(this._styleProps as Record<string, unknown>, {
        get: (t, prop) => {
          if (prop === 'setProperty') {
            return (k: string, v: string) => el._writeStyle(camelize(k), v);
          }
          if (prop === 'removeProperty') return (k: string) => el._writeStyle(camelize(k), '');
          if (prop === 'getPropertyValue') return (k: string) => t[camelize(k)] ?? '';
          if (prop === 'cssText') {
            return Object.entries(t)
              .map(([k, v]) => `${hyphenate(k)}: ${v};`)
              .join(' ');
          }
          if (typeof prop === 'string') return t[prop] ?? '';
          return undefined;
        },
        set: (_t, prop, v) => {
          if (typeof prop === 'string') el._writeStyle(prop, String(v));
          return true;
        },
        deleteProperty: (_t, prop) => {
          if (typeof prop === 'string') el._writeStyle(prop, '');
          return true;
        },
        has: (t, prop) => prop in t,
        ownKeys: (t) => Reflect.ownKeys(t),
        getOwnPropertyDescriptor: (t, prop) =>
          typeof prop === 'string' && prop in t
            ? { configurable: true, enumerable: true, value: t[prop] }
            : undefined,
      });
    }
    return this._styleObj as unknown as CSSStyleDeclaration;
  }

  /**
   * dataset — a Proxy mapping camelCase keys to `data-*` attribute ops.
   * `swatch.dataset.color = c` emits attr {name:'data-color', value:c};
   * `delete el.dataset.x` emits the removal form.
   */
  get dataset(): DOMStringMap {
    if (this._datasetObj === null) {
      const el = this;
      this._datasetObj = new Proxy({} as Record<string, string>, {
        get: (_t, prop) =>
          typeof prop === 'string' ? el._attrValue(`data-${hyphenate(prop)}`) : undefined,
        set: (_t, prop, v) => {
          if (typeof prop === 'string') el._setAttr(`data-${hyphenate(prop)}`, v);
          return true;
        },
        deleteProperty: (_t, prop) => {
          if (typeof prop === 'string') el.removeAttribute(`data-${hyphenate(prop)}`);
          return true;
        },
        has: (_t, prop) =>
          typeof prop === 'string' && el._attrs.has(`data-${hyphenate(prop)}`),
        ownKeys: () =>
          [...el._attrs.keys()].filter((k) => k.startsWith('data-')).map((k) => camelize(k.slice(5))),
        getOwnPropertyDescriptor: (_t, prop) => {
          if (typeof prop !== 'string') return undefined;
          const v = el._attrValue(`data-${hyphenate(prop)}`);
          return v === undefined ? undefined : { configurable: true, enumerable: true, value: v };
        },
      });
    }
    return this._datasetObj as unknown as DOMStringMap;
  }

  /**
   * Focus/blur — NO-OPS. Real focus can't be delivered over async postMessage
   * (the driver's dispatch fires after the event; there is no focus op).
   * They exist because gesture libraries call `el.focus()` unconditionally
   * during mousedown paths (Leaflet's Keyboard handler does).
   */
  focus(): void {}
  blur(): void {}

  /* Events — registers a worker handler-table entry and emits listen.
   * The driver's listenerFor dispatches EventPayloads back into the worker;
   * the payload is enriched with a synthesized `target` proxy node first. */
  addEventListener(type: string, fn: ProxyEventHandler): void {
    this.doc._assertAlive();
    // The real DOM dedupes identical (type, listener) pairs — so do we.
    if (this._listeners.some((l) => l.type === type && l.fn === fn)) return;
    const hid = registerHandler(
      (p) => fn(this.doc._enrichEvent(p as EventPayload)),
      this.instance.realm,
      this.instance.id,
    );
    this._listeners.push({ type, fn, hid });
    this.doc._handlerIds.add(hid);
    this._op({ t: 'listen', id: this.instance.id, type, handler: hid });
  }
  removeEventListener(type: string, fn: ProxyEventHandler): void {
    this.doc._assertAlive();
    const index = this._listeners.findIndex((l) => l.type === type && l.fn === fn);
    if (index === -1) return;
    const [entry] = this._listeners.splice(index, 1);
    unregisterHandler(entry.hid);
    this.doc._handlerIds.delete(entry.hid);
    this._op({ t: 'unlisten', id: this.instance.id, type, handler: entry.hid });
  }

  /** Live-descendant search over the shadow tree. Nodes mounted by the
   *  reconciler aren't reachable (the op stream doesn't mirror React's
   *  structure into _children) — adopted subtrees match only their own
   *  proxy-built descendants. Class matching reads _classes AND the
   *  instance's serialized className prop, so adopted React elements with
   *  className set still match. */
  getElementsByClassName(name: string): ProxyElement[] {
    this.doc._assertAlive();
    const out: ProxyElement[] = [];
    const visit = (el: ProxyElement): void => {
      for (const child of el._children) {
        if (!(child instanceof ProxyElement)) continue;
        const viaProps = ((child.instance.props?.className as string | undefined) ?? '')
          .split(/\s+/)
          .includes(name);
        if (child._classes.has(name) || viaProps) out.push(child);
        visit(child);
      }
    };
    visit(this);
    return out;
  }

  getElementsByTagName(tag: string): ProxyElement[] {
    this.doc._assertAlive();
    const want = tag.toLowerCase();
    const out: ProxyElement[] = [];
    const visit = (el: ProxyElement): void => {
      for (const child of el._children) {
        if (!(child instanceof ProxyElement)) continue;
        if (want === '*' || child.instance.type.toLowerCase() === want) out.push(child);
        visit(child);
      }
    };
    visit(this);
    return out;
  }

  /* SVG measurement APIs — no layout/text engine exists worker-side, so
   *  these report honest zeros (warned once), exactly like the rest of the
   *  geometry surface. Libraries doing animation sizing (recharts'
   *  getTotalLength paths) degrade to instant/no animation. */
  getBBox(): {
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
    right: number;
    bottom: number;
    left: number;
  } {
    this.doc._assertAlive();
    this.doc._warn('getBBox');
    return { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 };
  }

  getTotalLength(): number {
    this.doc._assertAlive();
    this.doc._warn('getTotalLength');
    return 0;
  }

  getComputedTextLength(): number {
    this.doc._assertAlive();
    this.doc._warn('getComputedTextLength');
    return 0;
  }

  /* Selector matching — compound selectors only (see parseSelector). */
  matches(selector: string): boolean {
    return matchesChain(this, parseSelector(selector));
  }

  /** Nearest element (self inclusive) matching the selector — walks the
   *  shadow tree upward through ancestors. */
  closest(selector: string): ProxyElement | null {
    const chain = parseSelector(selector);
    let n: ProxyNode | null = this;
    while (n !== null) {
      if (n instanceof ProxyElement && matchesChain(n, chain)) return n;
      n = n._parent;
    }
    return null;
  }

  /** Scoped local-tree query — descendants only, same engine and the same
   *  supported-selector subset as document.querySelectorAll. */
  querySelector(selector: string): ProxyElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): ProxyElement[] {
    const chain = parseSelector(selector);
    const out: ProxyElement[] = [];
    const walk = (node: ProxyNode): void => {
      for (const child of node._children) {
        if (child instanceof ProxyElement && matchesChain(child, chain)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  /* ── innerHTML + friends: real HTML parsing worker-side ──────────────── */

  /** Serialized shadow-tree children — the only innerHTML there CAN be over
   *  an async op channel (it reflects writes made through this facade, not
   *  the real DOM's current markup). */
  get innerHTML(): string {
    return this._children.map((child) => serializeNode(child)).join('');
  }
  /**
   * Parse `html` worker-side (htmlparser2 — pure JS, worker-safe) and
   * rebuild this element's children as proxy nodes: each parsed element is
   * createElement + setAttribute + recursive children, each text run a
   * createTextNode — all emitting ordinary create/attr/append ops. Existing
   * children are removed first (one remove op each). Comments and
   * directives are skipped.
   */
  set innerHTML(html: string) {
    this.doc._assertAlive();
    for (const child of this._children.slice()) this.removeChild(child);
    for (const node of parseChildren(this.doc, html)) this.appendChild(node);
  }

  /**
   * Parse `html` and insert the resulting nodes relative to this element —
   * 'beforebegin'/'afterend' require a parent and no-op without one (like
   * the DOM on detached elements).
   */
  insertAdjacentHTML(position: AdjacentPosition, html: string): void {
    this.doc._assertAlive();
    this._insertAt(position, parseChildren(this.doc, html));
  }

  /** insertAdjacentElement — returns the inserted element like the DOM. */
  insertAdjacentElement(position: AdjacentPosition, el: ProxyElement): ProxyElement | null {
    this.doc._assertAlive();
    if (!(el instanceof ProxyElement)) return null;
    this._insertAt(position, [el]);
    return el;
  }

  private _insertAt(position: AdjacentPosition, nodes: ProxyNode[]): void {
    switch (position) {
      case 'beforebegin': {
        if (this._parent === null) return;
        for (const n of nodes) this._parent.insertBefore(n, this);
        return;
      }
      case 'afterbegin': {
        const ref = this.firstChild;
        for (const n of nodes) this.insertBefore(n, ref);
        return;
      }
      case 'beforeend': {
        for (const n of nodes) this.appendChild(n);
        return;
      }
      case 'afterend': {
        if (this._parent === null) return;
        const ref = this.nextSibling;
        for (const n of nodes) this._parent.insertBefore(n, ref);
        return;
      }
      default:
        throw new Error(`proxyDom.insertAdjacent*: unknown position "${String(position)}"`);
    }
  }

  /**
   * Clone as new ops — the copy gets its own instance id (it's a real new
   * element on the main thread, not a shared record). Attributes and the
   * style-proxy properties are copied; listeners are NOT (matches the DOM).
   * `deep` clones element children recursively and text children as fresh
   * text nodes.
   */
  cloneNode(deep?: boolean): ProxyElement {
    this.doc._assertAlive();
    const copy = this.doc.createElement(this.instance.type);
    for (const [name, value] of this._attrs) copy.setAttribute(name, value);
    for (const [k, v] of Object.entries(this._styleProps)) copy._writeStyle(k, v);
    if (deep === true) {
      for (const child of this._children) {
        if (child instanceof ProxyElement) copy.appendChild(child.cloneNode(true));
        else if (child instanceof ProxyText) copy.appendChild(this.doc.createTextNode(child.textContent));
      }
    }
    return copy;
  }

  /** append(...nodes) — strings become text nodes, like the DOM. */
  append(...nodes: Array<ProxyNode | string>): void {
    this.doc._assertAlive();
    for (const n of nodes) {
      this.appendChild(typeof n === 'string' ? this.doc.createTextNode(n) : n);
    }
  }

  /** prepend(...nodes) — inserts at the front, in argument order. */
  prepend(...nodes: Array<ProxyNode | string>): void {
    this.doc._assertAlive();
    const ref = this.firstChild;
    for (const n of nodes) {
      this.insertBefore(typeof n === 'string' ? this.doc.createTextNode(n) : n, ref);
    }
  }

  /** replaceChildren(...nodes) — remove every child, then append the set. */
  replaceChildren(...nodes: Array<ProxyNode | string>): void {
    this.doc._assertAlive();
    for (const child of this._children.slice()) this.removeChild(child);
    this.append(...nodes);
  }

  /* ── Pushed-size geometry. The ONLY measured box is the island container:
   *  `doc.body`/`documentElement` and markContainer()ed elements report the
   *  last setSize push; everything else keeps the honest 0 and warns once
   *  per document per API. A marked element reports the CONTAINER's box —
   *  the driver can only measure the island's root, so "marked" means
   *  "pretend my box is the container's", which is only honest for elements
   *  that genuinely fill it. ── */
  getBoundingClientRect(): DOMRect {
    const size = this.doc._sizeFor(this);
    if (size === undefined) {
      this.doc._warn('getBoundingClientRect');
      return {
        x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
        toJSON: () => ({}),
      } as DOMRect;
    }
    return {
      x: 0, y: 0, top: 0, left: 0, right: size.w, bottom: size.h,
      width: size.w, height: size.h,
      toJSON: () => ({}),
    } as DOMRect;
  }
  get clientWidth(): number {
    return this._geom('clientWidth', (s) => s.w);
  }
  get clientHeight(): number {
    return this._geom('clientHeight', (s) => s.h);
  }
  get offsetWidth(): number {
    return this._geom('offsetWidth', (s) => s.w);
  }
  get offsetHeight(): number {
    return this._geom('offsetHeight', (s) => s.h);
  }
  /** Border edge widths — honestly 0 (the pushed box doesn't measure borders). */
  get clientLeft(): number {
    return 0;
  }
  get clientTop(): number {
    return 0;
  }
  /** Position within offsetParent — not measured; 0 is honest for root-level boxes. */
  get offsetLeft(): number {
    return 0;
  }
  get offsetTop(): number {
    return 0;
  }
  get offsetParent(): null {
    return null;
  }
  get scrollTop(): number {
    this.doc._warn('scrollTop');
    return 0;
  }
  set scrollTop(_v: number) {
    this.doc._warn('scrollTop');
  }
  get scrollLeft(): number {
    this.doc._warn('scrollLeft');
    return 0;
  }
  set scrollLeft(_v: number) {
    this.doc._warn('scrollLeft');
  }
  get scrollHeight(): number {
    this.doc._warn('scrollHeight');
    return 0;
  }
  get scrollWidth(): number {
    this.doc._warn('scrollWidth');
    return 0;
  }

  /**
   * Reflected properties. Library code assigns `img.src = url`,
   * `el.tabIndex = 0`, `link.href = '#'` — on a bare class instance those
   * become silent expandos and nothing crosses the wire. The attribute-backed
   * accessors below (defined for the properties real libraries poke) make
   * those assignments emit ordinary `attr` ops. Everything else still falls
   * through to a plain own-property — which is also exactly what library
   * expandos like `_leaflet_pos` need, so proxy elements are deliberately
   * NOT frozen/sealed.
   */
  get src(): string {
    return this._attrs.get('src') ?? '';
  }
  set src(v: string) {
    this._setAttr('src', v);
  }
  get srcset(): string {
    return this._attrs.get('srcset') ?? '';
  }
  set srcset(v: string) {
    this._setAttr('srcset', v);
  }
  get href(): string {
    return this._attrs.get('href') ?? '';
  }
  set href(v: string) {
    this._setAttr('href', v);
  }
  get alt(): string {
    return this._attrs.get('alt') ?? '';
  }
  set alt(v: string) {
    this._setAttr('alt', v);
  }
  get title(): string {
    return this._attrs.get('title') ?? '';
  }
  set title(v: string) {
    this._setAttr('title', v);
  }
  get tabIndex(): number {
    return Number(this._attrs.get('tabindex') ?? -1);
  }
  set tabIndex(v: number) {
    this._setAttr('tabindex', String(v));
  }
  get draggable(): boolean {
    return this._attrs.get('draggable') === 'true';
  }
  set draggable(v: boolean) {
    this._setAttr('draggable', String(v));
  }
  get crossOrigin(): string | null {
    return this._attrs.get('crossorigin') ?? null;
  }
  set crossOrigin(v: string | null) {
    if (v === null) this.removeAttribute('crossorigin');
    else this._setAttr('crossorigin', v);
  }
  get width(): number {
    return Number(this._attrs.get('width') ?? 0);
  }
  set width(v: number) {
    this._setAttr('width', String(v));
  }
  get height(): number {
    return Number(this._attrs.get('height') ?? 0);
  }
  set height(v: number) {
    this._setAttr('height', String(v));
  }
  get type(): string {
    return this._attrs.get('type') ?? '';
  }
  set type(v: string) {
    this._setAttr('type', v);
  }
  get loading(): string {
    return this._attrs.get('loading') ?? '';
  }
  set loading(v: string) {
    this._setAttr('loading', v);
  }
  get decoding(): string {
    return this._attrs.get('decoding') ?? '';
  }
  set decoding(v: string) {
    this._setAttr('decoding', v);
  }
  get value(): string {
    return this._attrs.get('value') ?? '';
  }
  set value(v: string) {
    this._setAttr('value', v);
  }
  get checked(): boolean {
    return this._attrs.has('checked');
  }
  set checked(v: boolean) {
    if (v) this._setAttr('checked', '');
    else this.removeAttribute('checked');
  }
  get disabled(): boolean {
    return this._attrs.has('disabled');
  }
  set disabled(v: boolean) {
    if (v) this._setAttr('disabled', '');
    else this.removeAttribute('disabled');
  }

  /* internals */
  /** Geometry read shared by the pushed-size getters above. */
  _geom(feature: string, pick: (size: { w: number; h: number }) => number): number {
    const size = this.doc._sizeFor(this);
    if (size === undefined) {
      this.doc._warn(feature);
      return 0;
    }
    return pick(size);
  }
  _attrValue(name: string): string | undefined {
    return this._attrs.get(name);
  }
  _writeStyle(key: string, value: string): void {
    this.doc._assertAlive();
    if (this._styleProps[key] === value) return;
    this._styleProps[key] = value;
    this._op({ t: 'style', id: this.instance.id, props: { [key]: value } });
  }
  private _setAttr(name: string, value: string): void {
    this.doc._assertAlive();
    const v = String(value);
    if (this._attrs.get(name) === v) return; // unchanged → no op
    this._attrs.set(name, v);
    this._afterAttrChange(name);
    this._op({ t: 'attr', id: this.instance.id, name, value: v });
  }
  private _afterAttrChange(name: string): void {
    if (name === 'class') {
      this._classes = new Set((this._attrs.get('class') ?? '').split(/\s+/).filter(Boolean));
    } else if (name === 'id') {
      this.doc._trackId(this);
    }
  }
  private _syncClasses(): void {
    const v = [...this._classes].join(' ');
    this._attrs.set('class', v);
    this._op({ t: 'attr', id: this.instance.id, name: 'class', value: v === '' ? null : v });
  }
}

/* ── Selectors (compound + descendant combinator only) ─────────────────── */

interface CompoundSelector {
  tag?: string;
  id?: string;
  classes: string[];
  attrs: Array<{ name: string; value?: string }>;
}

const unsupportedSelector = (sel: string): never => {
  throw new Error(
    `proxyDom.querySelector: unsupported selector "${sel}" — only tag, .class, #id, [attr], [attr="v"] and descendant combinators are supported`,
  );
};

function parseCompound(part: string, sel: string): CompoundSelector {
  const out: CompoundSelector = { classes: [], attrs: [] };
  let i = 0;
  const tag = /^[a-zA-Z][\w-]*/.exec(part);
  if (tag !== null) {
    out.tag = tag[0].toLowerCase();
    i = tag[0].length;
  }
  while (i < part.length) {
    const ch = part[i];
    if (ch === '#') {
      const m = /^[\w-]+/.exec(part.slice(i + 1));
      if (m === null) unsupportedSelector(sel);
      out.id = m![0];
      i += 1 + m![0].length;
    } else if (ch === '.') {
      const m = /^[\w-]+/.exec(part.slice(i + 1));
      if (m === null) unsupportedSelector(sel);
      out.classes.push(m![0]);
      i += 1 + m![0].length;
    } else if (ch === '[') {
      const end = part.indexOf(']', i);
      if (end === -1) unsupportedSelector(sel);
      const body = part.slice(i + 1, end).trim();
      const m = /^([\w-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^'"\s]+)))?$/.exec(body);
      if (m === null) unsupportedSelector(sel);
      out.attrs.push({ name: m![1], value: m![2] ?? m![3] ?? m![4] });
      i = end + 1;
    } else {
      unsupportedSelector(sel);
    }
  }
  if (
    out.tag === undefined &&
    out.id === undefined &&
    out.classes.length === 0 &&
    out.attrs.length === 0
  ) {
    unsupportedSelector(sel);
  }
  return out;
}

export function parseSelector(selector: string): CompoundSelector[] {
  const sel = selector.trim();
  if (
    sel === '' ||
    sel.includes(',') ||
    sel.includes('>') ||
    sel.includes('+') ||
    sel.includes('~') ||
    sel.includes(':')
  ) {
    unsupportedSelector(selector);
  }
  return sel.split(/\s+/).map((part) => parseCompound(part, selector));
}

export function matchCompound(el: ProxyElement, c: CompoundSelector): boolean {
  if (c.tag !== undefined && el.tagName.toLowerCase() !== c.tag) return false;
  if (c.id !== undefined && el._attrValue('id') !== c.id) return false;
  for (const cls of c.classes) if (!el._classes.has(cls)) return false;
  for (const a of c.attrs) {
    const v = el._attrValue(a.name);
    if (v === undefined) return false;
    if (a.value !== undefined && v !== a.value) return false;
  }
  return true;
}

/** `el` matches the last compound; each earlier compound must match some
 *  ancestor above the previous match — the descendant combinator. */
export function matchesChain(el: ProxyElement, chain: CompoundSelector[]): boolean {
  if (!matchCompound(el, chain[chain.length - 1])) return false;
  let cur: ProxyNode | null = el._parent;
  for (let i = chain.length - 2; i >= 0; i--) {
    let found = false;
    while (cur !== null) {
      if (cur instanceof ProxyElement && matchCompound(cur, chain[i])) {
        found = true;
        cur = cur._parent;
        break;
      }
      cur = cur._parent;
    }
    if (!found) return false;
  }
  return true;
}

/* ── HTML: parse (htmlparser2) + serialize (shadow tree) ───────────────── */

/**
 * Parse an HTML fragment into fresh proxy nodes — one createElement/
 * createTextNode/appendChild chain per parsed node, so setting innerHTML or
 * calling insertAdjacentHTML emits the same op stream hand-built code
 * would. htmlparser2 is pure JS — no DOM, worker-safe.
 */
/** A node in htmlparser2's parse tree — typed off the public API so no
 *  transitive domhandler import is needed. */
type ParsedNode = ReturnType<typeof parseDocument>['children'][number];

export function parseChildren(doc: InternalDocument, html: string): ProxyNode[] {
  const parsed = parseDocument(String(html));
  const build = (nodes: readonly ParsedNode[]): ProxyNode[] => {
    const out: ProxyNode[] = [];
    for (const node of nodes) {
      switch (node.type) {
        case ElementType.Tag:
        case ElementType.Script:
        case ElementType.Style: {
          const el = doc.createElement(node.name);
          for (const [name, value] of Object.entries(node.attribs)) el.setAttribute(name, value);
          for (const child of build(node.children)) el.appendChild(child);
          out.push(el);
          break;
        }
        case ElementType.Text: {
          if (node.data !== '') out.push(doc.createTextNode(node.data));
          break;
        }
        case ElementType.CDATA: {
          // CDATA carries its text as children — flatten like the DOM does.
          for (const child of build(node.children)) out.push(child);
          break;
        }
        default:
          break; // comments/directives/doctype: skipped.
      }
    }
    return out;
  };
  return build(parsed.children);
}

/** Elements the HTML serializer emits without an end tag. */
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const escapeText = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** Serialize a shadow node — elements with attrs (+ inline style from the
 *  style proxy), text escaped. Reads the shadow tree only; nothing the
 *  proxy didn't write appears here. */
export function serializeNode(node: ProxyNode): string {
  if (node instanceof ProxyText) return escapeText(node.textContent);
  if (!(node instanceof ProxyElement)) return '';
  const tag = node.instance.type;
  const attrs = new Map(node._attrs);
  const styleText = Object.entries(node._styleProps)
    .map(([k, v]) => `${hyphenate(k)}: ${v};`)
    .join(' ');
  if (styleText !== '') attrs.set('style', styleText);
  let out = `<${tag}`;
  for (const [name, value] of attrs) out += ` ${name}="${escapeAttr(value)}"`;
  if (VOID_ELEMENTS.has(tag)) return `${out}>`;
  out += '>';
  for (const child of node._children) out += serializeNode(child);
  return `${out}</${tag}>`;
}

/* ── The document ──────────────────────────────────────────────────────── */
