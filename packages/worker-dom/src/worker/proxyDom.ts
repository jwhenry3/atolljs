/**
 * A fake DOM facade for worker-side imperative code — the "WorkerDOM"
 * pattern. Where hostConfig.ts gives the RECONCILER a DOM-free host
 * environment, this module gives hand-written imperative code one: a
 * `proxyDocument` whose `createElement`/`appendChild`/`setAttribute`/
 * `addEventListener` look and feel like the real DOM but emit protocol ops
 * on every mutation instead of touching real nodes.
 *
 * SHARED INSTANCE SPACE: proxy nodes wrap the same host-instance records
 * react-reconciler uses — the same `instances` map, the same `allocId`
 * counter. Ops are id-addressed, so a proxy-created element can nest inside
 * a React-rendered parent and vice versa; `doc.adopt(instance)` wraps any
 * existing record (e.g. a React-rendered element) so imperative code can
 * navigate/mutate around it.
 *
 * SHADOW TREE: every proxy node keeps its own `childNodes`/`parentNode`
 * links, so navigation reads (`firstChild`, `nextSibling`, `children`,
 * `textContent`, `getElementById`, `querySelector`) are served locally —
 * the only DOM reads that CAN work over an async op channel. The shadow
 * tree only tracks mutations made THROUGH the proxy: children React
 * appends under an adopted parent aren't visible to it.
 *
 * GLOBAL SHIM: `installDomShim(doc)` assigns `globalThis.document = doc`
 * plus a `globalThis.window` facade, so DOM-dependent libraries written
 * for the real global scope run unmodified inside a realm — createElement,
 * innerHTML templates (parsed worker-side via htmlparser2), delegated
 * `document.addEventListener`/`window.addEventListener` (both land as
 * `listen` ops on the island's container — id 0 — where bubbling events
 * reach them). See installDomShim for exactly what is and isn't faked.
 *
 * REALM ROUTING: like `emit`, imperative DOM writes only happen while a
 * realm task holds the active realm — mount/dispatch wrap the app in
 * `runInRealm`, and worker-initiated work (timers, continuations) should
 * call `runInRealm(realm, fn)` itself. Instance-bound ops route by their
 * instance's realm even outside a task, but nothing drains the queue until
 * a task or flush runs — and `emit` ops would route to no queue at all.
 *
 * HONEST CONSTRAINT — write-path-only: there is no measurement channel.
 * `getBoundingClientRect`, `offsetWidth/Height`, `scrollTop/scrollHeight`,
 * `getComputedStyle` return 0/empty and warn once. Partytown solves this
 * with synchronous XHR/atomics round-trips to the main thread — noted as
 * future work, deliberately not faked here.
 */

import { parseDocument, ElementType } from 'htmlparser2';
import {
  allocId,
  bumpOpsVersion,
  getActiveRealm,
  instances,
  pushOp,
  registerHandler,
  unregisterHandler,
} from './hostConfig';
import type { ElementInstance, HostInstance, TextInstance } from './hostConfig';
import type { EventPayload, Op } from '../ops';

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
let nextPhantomId = -1;

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
    let beforeId: number | undefined;
    if (ref === null) {
      if (child._parent !== null) child._parent._detach(child);
      child._parent = this;
      this._children.push(child);
    } else {
      const index = this._children.indexOf(ref);
      if (index === -1) {
        throw new Error('proxyDom.insertBefore: reference node is not a child of this node');
      }
      if (child._parent !== null) child._parent._detach(child);
      child._parent = this;
      this._children.splice(index, 0, child);
      if (ref.instance.id > 0) beforeId = ref.instance.id;
    }
    // Phantom texts have no driver-side node to move — shadow-only.
    if (child.instance.id > 0) {
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
    if (child.instance.id > 0) this._op({ t: 'remove', child: child.instance.id });
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

  /* Events — registers a worker handler-table entry and emits listen.
   * The driver's listenerFor dispatches EventPayloads back into the worker;
   * the payload is enriched with a synthesized `target` proxy node first. */
  addEventListener(type: string, fn: ProxyEventHandler): void {
    this.doc._assertAlive();
    // The real DOM dedupes identical (type, listener) pairs — so do we.
    if (this._listeners.some((l) => l.type === type && l.fn === fn)) return;
    const hid = registerHandler((p) => fn(this.doc._enrichEvent(p as EventPayload)), this.instance.realm);
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

  /* ── Write-path-only stubs: NO measurement channel exists. Returning a
   *  fake non-zero number would be silently wrong; these return the honest
   *  zero/empty and warn once per document per API. ── */
  getBoundingClientRect(): DOMRect {
    this.doc._warn('getBoundingClientRect');
    return {
      x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
      toJSON: () => ({}),
    } as DOMRect;
  }
  get offsetWidth(): number {
    this.doc._warn('offsetWidth');
    return 0;
  }
  get offsetHeight(): number {
    this.doc._warn('offsetHeight');
    return 0;
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

  /* internals */
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

function parseSelector(selector: string): CompoundSelector[] {
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

function matchCompound(el: ProxyElement, c: CompoundSelector): boolean {
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
function matchesChain(el: ProxyElement, chain: CompoundSelector[]): boolean {
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

function parseChildren(doc: InternalDocument, html: string): ProxyNode[] {
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
function serializeNode(node: ProxyNode): string {
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

export interface ProxyDocument {
  /**
   * The island's root container — driver-side id 0. `body` and
   * `documentElement` are aliases of it; appending to either lands elements
   * at the island root. Its own attr/style/listen mutations target the real
   * container element.
   */
  readonly body: ProxyElement;
  readonly documentElement: ProxyElement;
  createElement(tag: string): ProxyElement;
  createTextNode(text: string): ProxyText;
  /**
   * Document-level listeners: emitted as `listen` ops on id 0 — the driver
   * attaches them to the island's real container element, so delegated
   * handlers see every event that bubbles inside the island. This is what
   * library-style `document.addEventListener('click', delegate)` needs.
   */
  addEventListener(type: string, fn: ProxyEventHandler): void;
  removeEventListener(type: string, fn: ProxyEventHandler): void;
  /** id-map lookup over the CONNECTED shadow tree (disconnected nodes with
   *  an id set are remembered but not returned, matching real-DOM scoping). */
  getElementById(id: string): ProxyElement | null;
  /** Simple matcher: tag/.class/#id/[attr]/[attr="v"] + descendant
   *  combinators. Anything else throws a clear unsupported-selector error. */
  querySelector(selector: string): ProxyElement | null;
  querySelectorAll(selector: string): ProxyElement[];
  /** Wrap an existing host-instance record (e.g. a React-rendered element
   *  reached via the shared `instances` map) so imperative code can navigate
   *  or mutate around it — the bridge for nesting proxy trees inside
   *  React-rendered parents and vice versa. */
  adopt(instance: HostInstance): ProxyNode;
  /** No measurement channel — returns an all-empty declaration (warns once). */
  getComputedStyle(el: ProxyElement): CSSStyleDeclaration;
  /** Unregister every handler this document's listeners hold. Called by the
   *  worker on rebuild so stale handler ids can't be dispatched into dead
   *  nodes; mutating a disposed document throws. */
  dispose(): void;
}

export class InternalDocument implements ProxyDocument {
  readonly realm: string;
  readonly _root: ProxyElement;
  readonly _wrappers = new Map<number, ProxyNode>();
  readonly _ids = new Map<string, ProxyElement>();
  /** handler ids this document registered — disposed on rebuild. */
  readonly _handlerIds = new Set<number>();
  /** Document-level listeners — separate table from the root element's, so
   *  doc.addEventListener and body.addEventListener don't wrongly dedupe
   *  against each other. Both emit `listen` on id 0. */
  private readonly _docListeners: Array<{ type: string; fn: ProxyEventHandler; hid: number }> = [];
  private readonly _warned = new Set<string>();
  _disposed = false;
  /** Set by installDomShim — restore globals when this document dies. */
  _uninstallShim: (() => void) | null = null;

  constructor(realm: string) {
    this.realm = realm;
    // id 0 is the driver-side island container sentinel — deliberately NOT
    // registered in `instances` (the driver's nodes map already maps 0 → el).
    this._root = new ProxyElement(this, {
      kind: 'element',
      id: 0,
      type: '#root',
      realm,
      props: {},
      listenerSlots: {},
    });
    this._wrappers.set(0, this._root);
  }

  get body(): ProxyElement {
    return this._root;
  }
  get documentElement(): ProxyElement {
    return this._root;
  }

  _assertAlive(): void {
    if (this._disposed) {
      throw new Error(
        'proxyDom: this document was disposed by an updateProps/remount rebuild — its nodes are detached',
      );
    }
  }

  _warn(feature: string): void {
    if (this._warned.has(feature)) return;
    this._warned.add(feature);
    console.warn(
      `[proxyDom] '${feature}' has no measurement channel — the worker DOM is write-path-only; reads return 0/empty.`,
    );
  }

  /** Keep the getElementById map pointing at each element's CURRENT id. */
  _trackId(el: ProxyElement): void {
    for (const [k, v] of this._ids) if (v === el) this._ids.delete(k);
    const id = el._attrValue('id');
    if (id !== undefined && id !== '') this._ids.set(id, el);
  }

  /** The synthetic text child an element's `textContent` setter leaves in
   *  the shadow tree — no driver-side node, so its writes retarget parent. */
  _phantomText(parent: ProxyNode, text: string): ProxyText {
    const t = new ProxyText(this, {
      kind: 'text',
      id: nextPhantomId--,
      text,
      realm: parent.instance.realm,
    });
    t._parent = parent;
    return t;
  }

  /**
   * Give a dispatched payload its `target` — the proxy node for targetId,
   * looked up in the shared instance space and wrapped in THIS document's
   * wrapper map (so `e.target.closest`/`.dataset`/`.contains` behave like
   * the real DOM for proxy-created nodes).
   */
  _enrichEvent(payload: EventPayload): EventPayload {
    const id = payload.targetId;
    if (typeof id !== 'number') return payload;
    const instance = instances.get(id);
    if (instance === undefined) return payload;
    return { ...payload, target: this._wrap(instance) };
  }

  createElement(tag: string): ProxyElement {
    this._assertAlive();
    const instance: ElementInstance = {
      kind: 'element',
      id: allocId(),
      type: tag.toLowerCase(),
      realm: this.realm,
      props: {},
      listenerSlots: {},
    };
    instances.set(instance.id, instance);
    pushOp(this.realm, { t: 'create', id: instance.id, type: instance.type, props: {} });
    if (getActiveRealm() !== this.realm) bumpOpsVersion();
    return this._wrap(instance) as ProxyElement;
  }

  createTextNode(text: string): ProxyText {
    this._assertAlive();
    const instance: TextInstance = {
      kind: 'text',
      id: allocId(),
      text: String(text),
      realm: this.realm,
    };
    instances.set(instance.id, instance);
    pushOp(this.realm, { t: 'text', id: instance.id, text: instance.text });
    if (getActiveRealm() !== this.realm) bumpOpsVersion();
    return this._wrap(instance) as ProxyText;
  }

  adopt(instance: HostInstance): ProxyNode {
    this._assertAlive();
    return this._wrap(instance);
  }

  /** Wrap (or return the existing wrapper for) a shared instance record. */
  _wrap(instance: HostInstance): ProxyNode {
    let node = this._wrappers.get(instance.id);
    if (node === undefined) {
      node =
        instance.kind === 'text'
          ? new ProxyText(this, instance)
          : new ProxyElement(this, instance as ElementInstance);
      this._wrappers.set(instance.id, node);
    }
    return node;
  }

  /**
   * Document-level listener — same currency as element addEventListener but
   * targeting id 0 (the island's container element). The driver's listen op
   * attaches a real DOM listener on the container, so events bubbling up
   * from any island child dispatch back here. Used by library code doing
   * delegated `document.addEventListener(...)`.
   */
  addEventListener(type: string, fn: ProxyEventHandler): void {
    this._assertAlive();
    if (this._docListeners.some((l) => l.type === type && l.fn === fn)) return;
    const hid = registerHandler((p) => fn(this._enrichEvent(p as EventPayload)), this.realm);
    this._docListeners.push({ type, fn, hid });
    this._handlerIds.add(hid);
    pushOp(this.realm, { t: 'listen', id: 0, type, handler: hid });
    if (getActiveRealm() !== this.realm) bumpOpsVersion();
  }

  removeEventListener(type: string, fn: ProxyEventHandler): void {
    this._assertAlive();
    const index = this._docListeners.findIndex((l) => l.type === type && l.fn === fn);
    if (index === -1) return;
    const [entry] = this._docListeners.splice(index, 1);
    unregisterHandler(entry.hid);
    this._handlerIds.delete(entry.hid);
    pushOp(this.realm, { t: 'unlisten', id: 0, type, handler: entry.hid });
    if (getActiveRealm() !== this.realm) bumpOpsVersion();
  }

  getElementById(id: string): ProxyElement | null {
    const el = this._ids.get(id);
    return el !== undefined && el.isConnected ? el : null;
  }

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
    walk(this._root);
    return out;
  }

  getComputedStyle(_el: ProxyElement): CSSStyleDeclaration {
    this._warn('getComputedStyle');
    // Every property reads ''; getPropertyValue('x') returns '' too.
    return new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => (prop === 'getPropertyValue' ? () => '' : ''),
    }) as unknown as CSSStyleDeclaration;
  }

  dispose(): void {
    // Restore globals FIRST if this doc was installed as the shim — the
    // rebuild path (updateProps) swaps in a fresh doc and re-installs.
    this._uninstallShim?.();
    this._uninstallShim = null;
    this._disposed = true;
    for (const hid of this._handlerIds) unregisterHandler(hid);
    this._handlerIds.clear();
  }
}

/**
 * A fresh proxy document scoped to one realm — created per imperative
 * mount and per rebuild (updateProps). Mutations emit ops onto the realm's
 * queue immediately; reads are served from the shadow tree.
 */
export const createProxyDocument = (realm: string): ProxyDocument =>
  new InternalDocument(realm);

/* ── The global shim ───────────────────────────────────────────────────── */

/** What installDomShim puts on globalThis.window — a facade OBJECT, not
 *  globalThis itself (the pool's message channel lives on self). */
export interface WindowShim {
  document: ProxyDocument;
  navigator: { userAgent: string };
  location: { href: string; reload(): void; assign(url: string): void; replace(url: string): void };
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio: number;
  requestAnimationFrame(cb: (time: number) => void): number;
  cancelAnimationFrame(id: number): void;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
  getComputedStyle(el: unknown): Record<string, never>;
  addEventListener(type: string, fn: ProxyEventHandler): void;
  removeEventListener(type: string, fn: ProxyEventHandler): void;
}

/**
 * The uninstall currently returned by the latest installDomShim — chained
 * so installing a fresh document's shim first unwinds the previous one
 * (otherwise uninstalling would restore a STALE proxy document).
 */
let activeShimUninstall: (() => void) | null = null;

/**
 * Install a proxy document as `globalThis.document` plus a `window` facade
 * — the entry point for running real DOM-dependent libraries unmodified
 * inside an island realm:
 *
 *   const doc = createProxyDocument(realm);
 *   installDomShim(doc);
 *   SomeVendorLib.mount(doc.body);  // uses document./window./innerHTML…
 *
 * What gets faked:
 *  - `globalThis.document` = the proxy document (all proxy behavior above)
 *  - `globalThis.window` = a facade OBJECT: navigator, location stubs,
 *    timers + rAF passthrough (setTimeout fallback where workers lack rAF),
 *    innerWidth/innerHeight/devicePixelRatio constants, empty
 *    getComputedStyle, and addEventListener.
 *  - `window.addEventListener` keeps a SEPARATE listener table and emits
 *    `listen`/`unlisten` ops on id 0 — same as `document.addEventListener`:
 *    the driver attaches real listeners to the island's container, so DOM
 *    events that bubble inside the island dispatch to window listeners too
 *    (matching real document→window bubbling for content events; there are
 *    no true window-level events — resize & co. never fire).
 *  - Events dispatched to shim listeners get `payload.target` synthesized
 *    to the proxy node for `targetId` — delegated handlers using
 *    `e.target.closest(…)`/`.dataset` work unmodified.
 *
 * What does NOT get touched — deliberately:
 *  - `globalThis.addEventListener`/`removeEventListener` and `self` — the
 *    pool's `self.onmessage` channel lives there; `window` is a facade
 *    object, not the global.
 *  - Any other global (history, fetch, localStorage…) — libraries touching
 *    them fail loudly, which is the honest answer.
 *
 * Returns `uninstall()` restoring the prior globals exactly. Also runs
 * automatically on `doc.dispose()` (the updateProps rebuild path) and is
 * superseded by a later installDomShim call — the last install wins.
 */
export function installDomShim(doc: ProxyDocument): () => void {
  const internal = doc as InternalDocument;
  const g = globalThis as Record<string, unknown>;

  // Unwind any previous install first — its captured "prior globals" are the
  // real originals (or globals from before the first shim).
  activeShimUninstall?.();
  activeShimUninstall = null;

  const hadDocument = 'document' in g;
  const prevDocument = g.document;
  const hadWindow = 'window' in g;
  const prevWindow = g.window;

  /** type → fn → handler id. Window listeners get their own table (a lib
   *  removing a document listener must not detach its window twin), but
   *  land on the same id-0 container as document listeners. */
  const windowListeners = new Map<string, Map<ProxyEventHandler, number>>();

  const pushDocOp = (op: Op): void => {
    pushOp(internal.realm, op);
    if (getActiveRealm() !== internal.realm) bumpOpsVersion();
  };

  const windowAddEventListener = (type: string, fn: ProxyEventHandler): void => {
    internal._assertAlive();
    let table = windowListeners.get(type);
    if (table === undefined) windowListeners.set(type, (table = new Map()));
    if (table.has(fn)) return; // real DOM dedupes identical pairs
    const hid = registerHandler(
      (p) => fn(internal._enrichEvent(p as EventPayload)),
      internal.realm,
    );
    table.set(fn, hid);
    internal._handlerIds.add(hid);
    pushDocOp({ t: 'listen', id: 0, type, handler: hid });
  };

  const windowRemoveEventListener = (type: string, fn: ProxyEventHandler): void => {
    internal._assertAlive();
    const table = windowListeners.get(type);
    const hid = table?.get(fn);
    if (hid === undefined) return;
    table!.delete(fn);
    unregisterHandler(hid);
    internal._handlerIds.delete(hid);
    pushDocOp({ t: 'unlisten', id: 0, type, handler: hid });
  };

  const raf = (g.requestAnimationFrame as ((cb: (time: number) => void) => number) | undefined);
  const caf = (g.cancelAnimationFrame as ((id: number) => void) | undefined);

  const windowFacade: WindowShim = {
    document: doc,
    navigator: { userAgent: 'mesh-worker-dom' },
    location: {
      href: 'about:blank',
      reload() {},
      assign(_url: string) {},
      replace(_url: string) {},
    },
    innerWidth: 0,
    innerHeight: 0,
    devicePixelRatio: 1,
    // Workers normally have no rAF — pass through when one exists (in-process
    // test), degrade to a 16ms timer otherwise.
    requestAnimationFrame(cb: (time: number) => void): number {
      return typeof raf === 'function'
        ? raf.call(globalThis, cb)
        : (setTimeout(() => cb(Date.now()), 16) as unknown as number);
    },
    cancelAnimationFrame(id: number): void {
      if (typeof caf === 'function') caf.call(globalThis, id);
      else clearTimeout(id);
    },
    setTimeout: setTimeout.bind(globalThis),
    clearTimeout: clearTimeout.bind(globalThis),
    setInterval: setInterval.bind(globalThis),
    clearInterval: clearInterval.bind(globalThis),
    // No measurement channel — an empty declaration, same honesty rule as
    // doc.getComputedStyle (which warns once); the facade stays silent.
    getComputedStyle: () => ({}),
    addEventListener: windowAddEventListener,
    removeEventListener: windowRemoveEventListener,
  };

  g.document = doc;
  g.window = windowFacade;

  const uninstall = (): void => {
    // Tear down surviving window listeners first — both wire ops and the
    // worker-side handler table entries.
    for (const [type, table] of windowListeners) {
      for (const hid of table.values()) {
        unregisterHandler(hid);
        internal._handlerIds.delete(hid);
        if (!internal._disposed) pushOp(internal.realm, { t: 'unlisten', id: 0, type, handler: hid });
      }
      table.clear();
    }
    if (hadDocument) g.document = prevDocument;
    else delete g.document;
    if (hadWindow) g.window = prevWindow;
    else delete g.window;
    if (activeShimUninstall === uninstall) activeShimUninstall = null;
  };

  internal._uninstallShim = uninstall;
  activeShimUninstall = uninstall;
  return uninstall;
}
