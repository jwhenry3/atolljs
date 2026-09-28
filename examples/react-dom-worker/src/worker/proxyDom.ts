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

/** Handler signature for proxy addEventListener — the plain wire payload. */
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
   * The driver's listenerFor dispatches EventPayloads back into the worker. */
  addEventListener(type: string, fn: ProxyEventHandler): void {
    this.doc._assertAlive();
    // The real DOM dedupes identical (type, listener) pairs — so do we.
    if (this._listeners.some((l) => l.type === type && l.fn === fn)) return;
    const hid = registerHandler((p) => fn(p as EventPayload), this.instance.realm);
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

  /**
   * innerHTML would need an HTML parser worker-side AND a "set innerHTML"
   * wire op — neither exists. Throw loudly rather than silently writing an
   * expando the main thread never sees.
   */
  get innerHTML(): string {
    throw new Error(
      'proxyDom: innerHTML is not supported — build nodes with createElement/createTextNode + appendChild',
    );
  }
  set innerHTML(_v: string) {
    throw new Error(
      'proxyDom: innerHTML is not supported — build nodes with createElement/createTextNode + appendChild',
    );
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
  private readonly _warned = new Set<string>();
  private _disposed = false;

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
