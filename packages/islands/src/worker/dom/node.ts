import {
  allocId,
  bumpOpsVersion,
  getActiveInstance,
  getLastActiveInstance,
  getInstanceSize,
  instances,
  markInstanceActive,
  pushOp,
  registerHandler,
  unregisterHandler,
} from '../instance';
import type { ElementInstance, HostInstance, TextInstance } from '../instance';
import type { EventPayload, Op } from '../../ops';

import type { InternalDocument, ProxyDocument } from './document';

/** Handler signature for proxy addEventListener — the wire payload plus a
 *  synthesized `target` (the proxy node for `targetId`, when known).
 *  `this` is bound to the node/document/facade the listener was attached
 *  to, like the real DOM's currentTarget. */
export type ProxyEventHandler = (this: unknown, payload: EventPayload) => void;

/** The subset of AddEventListenerOptions the `listen`/`unlisten` ops carry. */
export interface WireListenerOpts {
  once?: boolean;
  passive?: boolean;
  capture?: boolean;
}

/** Normalize the DOM's `options | captureFlag` argument into concrete flags. */
export const normalizeListenerOptions = (
  options?: boolean | AddEventListenerOptions | EventListenerOptions | null,
): { once: boolean; passive: boolean; capture: boolean } => {
  const o = (typeof options === 'boolean' ? { capture: options } : (options ?? {})) as AddEventListenerOptions;
  return { once: o.once === true, passive: o.passive === true, capture: o.capture === true };
};

/** The `opts` field for a listen/unlisten op — undefined when every flag is
 *  off so plain listeners emit the same op shape as before. */
export const listenerOptsForWire = (
  options?: boolean | AddEventListenerOptions | EventListenerOptions | null,
): WireListenerOpts | undefined => {
  const o = normalizeListenerOptions(options);
  return o.once || o.passive || o.capture
    ? { once: o.once, passive: o.passive, capture: o.capture }
    : undefined;
};

export const hyphenate = (k: string): string => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
export const camelize = (k: string): string => k.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());

/**
 * Phantom instance ids — negative, so they can never collide with allocId's
 * positive ids and are never registered in `instances`. A phantom is the
 * synthetic text child an element's `textContent` setter leaves in the
 * shadow tree (the real DOM gets the same effect from `utext` on the
 * parent, which is why phantom mutations retarget the parent — see below).
 */
let nextPhantomId = -1;
export const allocPhantomId = (): number => nextPhantomId--;

/**
 * A node that isn't a ProxyNode can only arrive via a foreign `document`
 * (the dispatcher's real-DOM fallback or a poisoned override) — typically a
 * library's deferred callback running after its instance was torn down, or
 * globals restored while worker-side timers still fire. Adopting it would
 * crash later on `child.instance`; reject it here with the actual cause.
 */
export const rejectForeignChild = (child: unknown): never => {
  throw new Error(
    'proxyDom.insertBefore: child is not a proxy node — the ambient `document`/' +
      '`createElement` resolved a foreign DOM (a stale override or the real one), ' +
      'so this node was created outside the instance that owns the parent',
  );
};

/**
 * Detach `child` from its recorded parent, tolerating a stale/foreign
 * `_parent` link (undefined, or a non-proxy object) instead of crashing on
 * `_detach` — a corrupted link is cleared, a valid one is honored.
 */
export const detachFromParent = (child: ProxyNode): void => {
  const p = child._parent;
  if (p instanceof ProxyNode) p._detach(child);
  else child._parent = null;
};

/** Strings become text nodes — the ChildNode/ParentNode convenience arg. */
const asChild = (doc: InternalDocument, n: ProxyNode | string): ProxyNode =>
  typeof n === 'string' ? doc.createTextNode(n) : n;

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

  /**
   * '#text'/'#comment'/'#document-fragment' for character/fragment nodes;
   * the tag name for elements — uppercase in the HTML namespace, verbatim
   * for namespaced elements (svg 'foreignObject' keeps its case, matching
   * the real DOM).
   */
  get nodeName(): string {
    switch (this.nodeType) {
      case 1: {
        const inst = this.instance as ElementInstance;
        return inst.ns === undefined ? inst.type.toUpperCase() : inst.type;
      }
      case 3:
        return '#text';
      case 8:
        return '#comment';
      case 11:
        return '#document-fragment';
      default:
        return '#node';
    }
  }

  /** The proxy document that owns this node — what real DOM code reads as
   *  `el.ownerDocument`. */
  get ownerDocument(): ProxyDocument {
    return this.doc;
  }

  get parentNode(): ProxyNode | null {
    return this._parent;
  }
  get parentElement(): ProxyNode | null {
    // structural Element check — importing ProxyElement here would create a
    // module cycle because ProxyElement extends ProxyNode.
    return this._parent !== null && this._parent.nodeType === 1 ? this._parent : null;
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

  /** Concatenated descendant text — walked from the shadow tree. Comments
   *  are excluded: the DOM's descendant text content is Text-node data only. */
  get textContent(): string {
    let out = '';
    for (const child of this._children) {
      if (child.nodeType !== 8) out += child.textContent;
    }
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
    // Character-data nodes can't hold children — the driver replays every
    // emitted append as a real insertBefore, which would throw
    // HierarchyRequestError on the page; fail here first, like the DOM.
    if (this.nodeType === 3 || this.nodeType === 8) {
      throw new Error(
        `proxyDom.insertBefore: ${this.nodeName} nodes cannot have children`,
      );
    }
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

  /* ── ChildNode / ParentNode conveniences ───────────────────────────────
   * Strings become text nodes like the DOM. before/after/replaceWith on a
   * parentless node are no-ops (per spec). append/prepend/replaceChildren
   * live on the base so elements AND fragments share them — real DOM also
   * exposes them on DocumentFragment. */

  before(...nodes: Array<ProxyNode | string>): void {
    const p = this._parent;
    if (p === null) return;
    for (const n of nodes) p.insertBefore(asChild(this.doc, n), this);
  }

  after(...nodes: Array<ProxyNode | string>): void {
    const p = this._parent;
    if (p === null) return;
    const ref = this.nextSibling;
    for (const n of nodes) p.insertBefore(asChild(this.doc, n), ref);
  }

  replaceWith(...nodes: Array<ProxyNode | string>): void {
    const p = this._parent;
    if (p === null) return;
    for (const n of nodes) p.insertBefore(asChild(this.doc, n), this);
    p.removeChild(this);
  }

  /** append(...nodes) — strings become text nodes, like the DOM. */
  append(...nodes: Array<ProxyNode | string>): void {
    this.doc._assertAlive();
    for (const n of nodes) this.appendChild(asChild(this.doc, n));
  }

  /** prepend(...nodes) — inserts at the front, in argument order. */
  prepend(...nodes: Array<ProxyNode | string>): void {
    this.doc._assertAlive();
    const ref = this.firstChild;
    for (const n of nodes) this.insertBefore(asChild(this.doc, n), ref);
  }

  /** replaceChildren(...nodes) — remove every child, then append the set. */
  replaceChildren(...nodes: Array<ProxyNode | string>): void {
    this.doc._assertAlive();
    for (const child of this._children.slice()) this.removeChild(child);
    this.append(...nodes);
  }

  /**
   * Structural clone — each concrete kind implements it. The copy is a
   * FRESH instance (own id, own create op), not a shared record; listeners
   * never cross, matching the DOM.
   */
  cloneNode(_deep?: boolean): ProxyNode {
    throw new Error('proxyDom.cloneNode: unsupported node kind');
  }

  /**
   * Queue an op on this node's instance — the same routing hostConfig uses for
   * instance-bound ops. Outside a instance task the op still lands on the right
   * queue, and the doorbell is bumped so push-mode islands pick it up.
   */
  _op(op: Op): void {
    pushOp(this.instance.instance, op);
    if (getActiveInstance() !== this.instance.instance) bumpOpsVersion();
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

  /** Fresh text node — the clone is a new `text` op, not a shared record. */
  override cloneNode(_deep?: boolean): ProxyText {
    return this.doc.createTextNode(this.instance.text);
  }
}

/* ── ProxyComment ────────────────────────────────────────────────────── */

/**
 * Comment — nodeType 8, backed by a REAL empty text node driver-side: the
 * wire has no comment op, so `createComment` emits a `text` op with ''
 * giving the node a `before:`-addressable position for anchors (Svelte's
 * `<!>` block boundaries, Vue/Angular comment anchors).
 *
 * `data`/`nodeValue`/`textContent` writes update the shadow record ONLY —
 * emitting `utext` would render the comment's data as visible page text.
 */
export class ProxyComment extends ProxyText {
  override get nodeType(): number {
    return 8;
  }

  override get data(): string {
    return this.instance.text;
  }
  override set data(v: string) {
    this._shadowWrite(v);
  }
  override get nodeValue(): string {
    return this.instance.text;
  }
  override set nodeValue(v: string) {
    this._shadowWrite(v);
  }
  override get textContent(): string {
    return this.instance.text;
  }
  override set textContent(v: string) {
    this._shadowWrite(v);
  }

  private _shadowWrite(v: string): void {
    this.doc._assertAlive();
    this.instance.text = String(v);
  }

  override cloneNode(_deep?: boolean): ProxyComment {
    return this.doc.createComment(this.data);
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

  /** Fresh fragment; `deep` clones children polymorphically so comment
   *  anchors keep nodeType 8. */
  cloneNode(deep?: boolean): ProxyFragment {
    const copy = this.doc.createDocumentFragment();
    if (deep === true) {
      for (const child of this._children) copy.appendChild(child.cloneNode(true));
    }
    return copy;
  }
}

