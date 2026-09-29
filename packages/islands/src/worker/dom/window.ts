import { parseDocument, ElementType } from 'htmlparser2';
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

import {
  activeInstanceDoc,
  ambientDoc,
  createProxyDocument,
  docForInstance,
  type InternalDocument,
  type ProxyDocument,
} from './document';
import { ProxyElement } from './element';
import {
  ProxyNode,
  ProxyText,
  ProxyComment,
  listenerOptsForWire,
  normalizeListenerOptions,
  type ProxyEventHandler,
} from './node';

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
  cancelAnimationFrame(id?: number): void;
  setTimeout(
    callback: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ): number;
  clearTimeout(id?: number): void;
  setInterval(
    callback: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ): number;
  clearInterval(id?: number): void;
  getComputedStyle(el: unknown): Record<string, never>;
  /** Media queries can't be answered worker-side — always `matches: false`. */
  matchMedia(query: string): MediaQueryList;
  addEventListener(
    type: string,
    fn: ProxyEventHandler,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    fn: ProxyEventHandler,
    options?: boolean | EventListenerOptions,
  ): void;
  /** Scrolling is main-thread business — no-ops so window.scrollTo(x,y)
   *  calls in libraries don't throw. */
  scrollTo(x?: number | ScrollToOptions, y?: number): void;
  scrollBy(x?: number | ScrollToOptions, y?: number): void;
  scroll(x?: number | ScrollToOptions, y?: number): void;
}

/**
 * The uninstall currently returned by the latest installDomShim — chained
 * so installing a fresh document's shim first unwinds the previous one.
 */
let activeShimUninstall: (() => void) | null = null;

export interface WindowFacadeBundle {
  facade: WindowShim;
  /** Detach every surviving window listener — ops and handler-table entries. */
  teardown(): void;
}

/**
 * Build the `window` facade for one instance's document — shared by
 * installDomShim (imperative apps) and the instance dispatcher (React mounts
 * get a window the first time library code reads one). The bundle caches
 * on the document so both paths hand out the SAME facade — a listener
 * registered through `window` must land in the same table whichever global
 * routed the call.
 */
const buildWindowFacade = (internal: InternalDocument): WindowFacadeBundle => {
  const g = globalThis as Record<string, unknown>;

  /** type → registered listener entries. Window listeners get their own
   *  table (a lib removing a document listener must not detach its window
   *  twin), but land on the same id-0 container as document listeners. */
  const windowListeners = new Map<
    string,
    Array<{ fn: ProxyEventHandler; hid: number; capture: boolean }>
  >();

  const pushDocOp = (op: Op): void => {
    pushOp(internal.instance, op);
    if (getActiveInstance() !== internal.instance) bumpOpsVersion();
  };

  const windowRemoveEventListener = (
    type: string,
    fn: ProxyEventHandler,
    options?: boolean | EventListenerOptions,
  ): void => {
    internal._assertAlive();
    const capture = normalizeListenerOptions(options).capture;
    const table = windowListeners.get(type);
    const index = table?.findIndex((l) => l.fn === fn && l.capture === capture) ?? -1;
    if (index === -1 || table === undefined) return;
    const [entry] = table.splice(index, 1);
    unregisterHandler(entry.hid);
    internal._handlerIds.delete(entry.hid);
    pushDocOp({
      t: 'unlisten',
      id: 0,
      type,
      handler: entry.hid,
      opts: entry.capture ? { capture: true } : undefined,
    });
  };

  const windowAddEventListener = (
    type: string,
    fn: ProxyEventHandler,
    options?: boolean | AddEventListenerOptions,
  ): void => {
    internal._assertAlive();
    const opts = normalizeListenerOptions(options);
    let table = windowListeners.get(type);
    if (table === undefined) windowListeners.set(type, (table = []));
    // real DOM dedupes identical (type, listener, capture) triples
    if (table.some((l) => l.fn === fn && l.capture === opts.capture)) return;
    const hid = registerHandler(
      (p) => {
        try {
          fn.call(facade, internal._enrichEvent(p as EventPayload, facade));
        } finally {
          if (opts.once) windowRemoveEventListener(type, fn, { capture: opts.capture });
        }
      },
      internal.instance,
      0, // window-level listener → target id 0 is the island root
    );
    table.push({ fn, hid, capture: opts.capture });
    internal._handlerIds.add(hid);
    pushDocOp({ t: 'listen', id: 0, type, handler: hid, opts: listenerOptsForWire(options) });
  };

  const raf = g.requestAnimationFrame as ((cb: (time: number) => void) => number) | undefined;
  const caf = g.cancelAnimationFrame as ((id: number) => void) | undefined;
  const globalSetTimeout = g.setTimeout as typeof setTimeout;
  const globalSetInterval = g.setInterval as typeof setInterval;
  const globalClearTimeout = g.clearTimeout as typeof clearTimeout;
  const globalClearInterval = g.clearInterval as typeof clearInterval;

  // A instance owns the timers/rAFs it schedules through this facade; teardown
  // cancels them so deferred library work (Leaflet drag inertia, scroll-zoom
  // debounces, etc.) doesn't outlive the document and mutate a dead or
  // foreign ambient DOM. We wrap callbacks so completed ones drop their id.
  const timeouts = new Set<number>();
  const intervals = new Set<number>();
  const rafs = new Set<number>();

  const facade: WindowShim = {
    document: internal,
    navigator: { userAgent: 'atoll-islands' },
    location: {
      href: 'about:blank',
      reload() {},
      assign(_url: string) {},
      replace(_url: string) {},
    },
    get innerWidth(): number {
      // Fed by the pushed container size — the viewport the island lives in.
      return getInstanceSize(internal.instance)?.w ?? 0;
    },
    get innerHeight(): number {
      return getInstanceSize(internal.instance)?.h ?? 0;
    },
    devicePixelRatio: 1,
    // Workers normally have no rAF — pass through when one exists (in-process
    // test), degrade to a 16ms timer otherwise. Schedule through the host
    // timers but keep track of the handles so teardown can cancel pending
    // callbacks (Leaflet's drag/zoom animations, etc.).
    requestAnimationFrame(cb: (time: number) => void): number {
      let id: number;
      const wrapped = (time: number): void => {
        rafs.delete(id);
        cb(time);
      };
      id = typeof raf === 'function'
        ? raf.call(globalThis, wrapped)
        : (globalSetTimeout((stamp: number) => wrapped(stamp), 16, Date.now()) as unknown as number);
      rafs.add(id);
      return id;
    },
    cancelAnimationFrame(id?: number): void {
      if (id === undefined) return;
      rafs.delete(id);
      if (typeof caf === 'function') caf.call(globalThis, id);
      else globalClearTimeout(id);
    },
    setTimeout(...args: Parameters<typeof setTimeout>): number {
      const [cb, delay, ...rest] = args as [
        cb: (...a: unknown[]) => void,
        delay?: number,
        ...rest: unknown[],
      ];
      let id: number;
      const wrapped = (...a: unknown[]): void => {
        timeouts.delete(id);
        cb(...a);
      };
      id = globalSetTimeout(wrapped, delay, ...rest) as unknown as number;
      timeouts.add(id);
      return id;
    },
    clearTimeout(id?: number): void {
      if (id === undefined) return;
      timeouts.delete(id);
      globalClearTimeout(id);
    },
    setInterval(...args: Parameters<typeof setInterval>): number {
      const [cb, delay, ...rest] = args as [
        cb: (...a: unknown[]) => void,
        delay?: number,
        ...rest: unknown[],
      ];
      const id = globalSetInterval(cb, delay, ...rest) as unknown as number;
      intervals.add(id);
      return id;
    },
    clearInterval(id?: number): void {
      if (id === undefined) return;
      intervals.delete(id);
      globalClearInterval(id);
    },
    // No measurement channel — an empty declaration, same honesty rule as
    // doc.getComputedStyle (which warns once); the facade stays silent.
    getComputedStyle: () => ({}),
    // No preference/quiz surface exists worker-side — media queries never
    // match. The shape is complete enough for feature-detection code.
    matchMedia: (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
    addEventListener: windowAddEventListener,
    removeEventListener: windowRemoveEventListener,
    // No scroll surface exists worker-side — libraries call these during
    // gesture handlers (Leaflet's Keyboard._onMouseDown scrolls the page
    // back); honest no-ops.
    scrollTo: () => {},
    scrollBy: () => {},
    scroll: () => {},
  };

  const teardown = (): void => {
    for (const id of rafs) {
      if (typeof caf === 'function') caf.call(globalThis, id);
      else globalClearTimeout(id);
    }
    rafs.clear();
    for (const id of timeouts) globalClearTimeout(id);
    timeouts.clear();
    for (const id of intervals) globalClearInterval(id);
    intervals.clear();
    for (const [type, table] of windowListeners) {
      for (const entry of table) {
        unregisterHandler(entry.hid);
        internal._handlerIds.delete(entry.hid);
        if (!internal._disposed) {
          pushOp(internal.instance, { t: 'unlisten', id: 0, type, handler: entry.hid });
        }
      }
      table.length = 0;
    }
  };

  return { facade, teardown };
};

/** The document's window facade, built once and shared by every path. */
const windowFacadeFor = (internal: InternalDocument): WindowFacadeBundle => {
  if (internal._windowBundle === undefined) {
    internal._windowBundle = buildWindowFacade(internal);
  }
  return internal._windowBundle;
};

let instanceDispatcherInstalled = false;

/**
 * Define `document`/`window`/`Element` as GLOBAL GETTERS that resolve to
 * the current instance's proxy document — the mechanism that lets React-island
 * libraries (recharts reading `window.getComputedStyle`, `document.body`)
 * work without their app ever touching a doc, and that routes imperative
 * library calls correctly when several mounts share one module (the
 * in-process test layout).
 *
 * Resolution (docForCurrentContext): the active instance's doc inside tasks;
 * the single registered doc when only one instance exists — every real island
 * worker, so timer/promise callbacks from libraries still hit their own
 * document; the most recent instance's doc as a final multi-instance fallback;
 * the pre-install global otherwise (a real document in happy-dom tests —
 * transparent to shell-side code, which never runs inside a instance task).
 */
/**
 * Stand-ins for bare-global feature probes framework code runs inside a
 * instance — a real worker has no `HTMLMediaElement` constructor or
 * `customElements` registry, so `x instanceof HTMLMediaElement` /
 * `customElements.get(...)` would ReferenceError. The class never matches
 * an instanceof; the registry reports nothing defined. A host-provided
 * global (happy-dom) wins over the stub whenever one exists.
 */
const HTML_MEDIA_STUB = class HTMLMediaElement {};
const CUSTOM_ELEMENTS_STUB = {
  get: () => undefined,
  define: () => {},
  upgrade: () => {},
  // Honest answer for "will this element ever upgrade" — it won't.
  whenDefined: () => new Promise<never>(() => {}),
};

export function installInstanceDispatcher(): void {
  if (instanceDispatcherInstalled) return;
  instanceDispatcherInstalled = true;
  const g = globalThis as Record<string, unknown>;
  const prevDocument = g.document;
  const prevWindow = g.window;
  const prevElement = g.Element;
  const prevNode = g.Node;
  const prevText = g.Text;
  const prevComment = g.Comment;
  const prevMedia = g.HTMLMediaElement;
  const prevCustomElements = g.customElements;
  // Explicit assignments override the fallback (never the in-instance doc) —
  // keeps pre-dispatcher semantics for out-of-instance code, and lets test
  // harnesses/suites restore globals by plain assignment.
  let docOverride: unknown;
  let winOverride: unknown;
  let elOverride: unknown;

  Object.defineProperty(g, 'document', {
    configurable: true,
    enumerable: true,
    get: () => activeInstanceDoc() ?? docOverride ?? ambientDoc() ?? prevDocument,
    set: (v) => {
      docOverride = v;
    },
  });
  Object.defineProperty(g, 'window', {
    configurable: true,
    enumerable: true,
    get: () => {
      const doc = activeInstanceDoc();
      if (doc !== undefined) return windowFacadeFor(doc).facade;
      if (winOverride !== undefined) return winOverride;
      const ambient = ambientDoc();
      return ambient !== undefined ? windowFacadeFor(ambient).facade : prevWindow;
    },
    set: (v) => {
      winOverride = v;
    },
  });
  // Workers lack the Element constructor — `x instanceof Element` inside a
  // library would ReferenceError. Point it at ProxyElement while a instance
  // doc is resolvable; real HTMLElement checks never run worker-side.
  Object.defineProperty(g, 'Element', {
    configurable: true,
    enumerable: true,
    get: () => {
      if (activeInstanceDoc() !== undefined) return ProxyElement;
      if (elOverride !== undefined) return elOverride;
      return ambientDoc() !== undefined ? ProxyElement : prevElement;
    },
    set: (v) => {
      elOverride = v;
    },
  });

  /**
   * Class globals — same resolution shape as `Element` above (in-instance →
   *   proxy class/stub; else explicit override; else ambient → proxy/stub;
   *   else the captured pre-dispatcher value). Frameworks cache prototype
   *   getters (`Node.prototype.firstChild`) and do `x instanceof Comment`
   *   before touching the document, so these must BE the proxy classes —
   *   not dispatchers that return different objects per instance.
   */
  const installClassGlobal = (name: string, instanceValue: unknown, prev: unknown): void => {
    let override: unknown;
    Object.defineProperty(g, name, {
      configurable: true,
      enumerable: true,
      get: () => {
        if (activeInstanceDoc() !== undefined) return instanceValue;
        if (override !== undefined) return override;
        return ambientDoc() !== undefined ? instanceValue : prev;
      },
      set: (v) => {
        override = v;
      },
    });
  };

  installClassGlobal('Node', ProxyNode, prevNode);
  installClassGlobal('Text', ProxyText, prevText);
  installClassGlobal('Comment', ProxyComment, prevComment);
  installClassGlobal(
    'HTMLMediaElement',
    typeof prevMedia === 'function' ? prevMedia : HTML_MEDIA_STUB,
    prevMedia,
  );
  installClassGlobal(
    'customElements',
    prevCustomElements !== undefined ? prevCustomElements : CUSTOM_ELEMENTS_STUB,
    prevCustomElements,
  );
}

/**
 * Install this document as the instance's DOM surface — the entry point for
 * running real DOM-dependent libraries unmodified inside an island instance:
 *
 *   const doc = createProxyDocument(instance);
 *   installDomShim(doc);
 *   SomeVendorLib.mount(doc.body);  // uses document./window./innerHTML…
 *
 * Under the instance dispatcher (installed here automatically, and by
 * definePolyWorker for every island worker) `globalThis.document` and
 * `globalThis.window` already resolve to this document while its instance is
 * active — so this call's real work is building the window facade
 * (navigator/location stubs, timers + rAF passthrough, innerWidth/Height
 * from the pushed container size, empty getComputedStyle, never-matching
 * matchMedia, addEventListener wired to `listen` ops on id 0) and exposing
 * it as `document.defaultView`.
 *
 * It also pins the CLASS globals (`Node`/`Text`/`Comment` → the proxy
 * classes; `HTMLMediaElement`/`customElements` → never-match stubs) for
 * framework feature probes — the instance dispatcher resolves them
 * ambiently anyway, so the assignment makes this document's install
 * explicit and restores the previous values on uninstall.
 *
 * What does NOT get touched — deliberately:
 *  - `globalThis.addEventListener`/`removeEventListener` and `self` — the
 *    pool's `self.onmessage` channel lives there; `window` is a facade
 *    object, not the global.
 *  - Any other global (history, fetch, localStorage…) — libraries touching
 *    them fail loudly, which is the honest answer.
 *
 * Returns `uninstall()` tearing down the facade's listeners. Also runs
 * automatically on `doc.dispose()` (the updateProps rebuild path) and is
 * superseded by a later installDomShim call — the last install wins.
 */
export function installDomShim(doc: ProxyDocument): () => void {
  const internal = doc as InternalDocument;
  installInstanceDispatcher();
  const g = globalThis as Record<string, unknown>;
  activeShimUninstall?.();
  activeShimUninstall = null;

  // Capture the ambient state BEFORE this doc claims it — uninstall puts
  // it all back, so chained installs restore true originals.
  const prevInstance = getLastActiveInstance();
  const prevDocument = g.document;
  const prevWindow = g.window;
  const prevElement = g.Element;
  const prevNode = g.Node;
  const prevText = g.Text;
  const prevComment = g.Comment;
  const prevMedia = g.HTMLMediaElement;
  const prevCustomElements = g.customElements;

  // The installed document becomes the ambient one for out-of-instance
  // readers: the explicit assignment wins the dispatcher's resolution,
  // and the instance is marked for implicit resolution paths.
  markInstanceActive(internal.instance);
  const bundle = windowFacadeFor(internal);
  g.document = doc;
  g.window = bundle.facade;
  g.Element = ProxyElement;
  g.Node = ProxyNode;
  g.Text = ProxyText;
  g.Comment = ProxyComment;
  if (typeof g.HTMLMediaElement !== 'function') g.HTMLMediaElement = HTML_MEDIA_STUB;
  if (g.customElements === undefined) g.customElements = CUSTOM_ELEMENTS_STUB;

  const uninstall = (): void => {
    bundle.teardown();
    internal._windowBundle = undefined;
    g.document = prevDocument;
    g.window = prevWindow;
    g.Element = prevElement;
    g.Node = prevNode;
    g.Text = prevText;
    g.Comment = prevComment;
    g.HTMLMediaElement = prevMedia;
    g.customElements = prevCustomElements;
    markInstanceActive(prevInstance);
    if (activeShimUninstall === uninstall) activeShimUninstall = null;
  };

  internal._uninstallShim = uninstall;
  activeShimUninstall = uninstall;
  return uninstall;
}
