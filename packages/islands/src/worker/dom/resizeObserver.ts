import type { MeasuredRect } from '../../ops';
import {
  activeInstanceDoc,
  ambientDoc,
  type InternalDocument,
} from './document';
import { ProxyElement } from './element';
import type { HostInstance } from '../instance';

/**
 * A `ResizeObserver` over the pushed-measure channel — the class
 * `globalThis.ResizeObserver`/`window.ResizeObserver` resolve to inside an
 * island instance. Each `observe(el)` registers a `doc.observeSize`
 * subscription (which emits the `measure` op once per element); each pushed
 * rect invokes the callback with a single-entry batch, matching how real RO
 * delivers per-element observations (the driver already batches the wire
 * push, the DOM API just doesn't promise same-batch grouping).
 *
 * Entries carry the fields layout libraries read: `target`, `contentRect`
 * (the measured box), and `borderBoxSize`/`contentBoxSize`/`devicePixelContentBoxSize`
 * arrays (echarts zrender, recharts' ResponsiveContainer, and RO-polyfill-
 * style code paths). Box options are accepted but ignored — the channel
 * delivers one box and it answers both reads.
 *
 * No doc resolvable (module-scope or post-unmount construction) means there
 * is nothing that could ever be measured — observe() silently no-ops rather
 * than pinning a foreign document, the same resolution rule the
 * `document`/`window` global dispatchers use.
 */
export class ProxyResizeObserver {
  private readonly _callback: ResizeObserverCallback;
  /** proxy el → the observeSize detacher (unobserve/disconnect paths). */
  private readonly _targets = new Map<ProxyElement, () => void>();

  constructor(callback: ResizeObserverCallback) {
    this._callback = callback;
  }

  observe(target: unknown, _options?: ResizeObserverOptions): void {
    const doc = activeInstanceDoc() ?? ambientDoc();
    if (doc === undefined) return;
    const el = toProxyElement(doc, target);
    if (el === null || this._targets.has(el)) return;
    const unobserve = (doc as InternalDocument).observeSize(el, (rect) => {
      this._callback(
        [entryFor(el, rect)] as unknown as ResizeObserverEntry[],
        this as unknown as ResizeObserver,
      );
    });
    this._targets.set(el, unobserve);
  }

  unobserve(target: unknown): void {
    const doc = activeInstanceDoc() ?? ambientDoc();
    if (doc === undefined) return;
    const el = toProxyElement(doc, target);
    if (el === null) return;
    this._targets.get(el)?.();
    this._targets.delete(el);
  }

  disconnect(): void {
    for (const unobserve of this._targets.values()) unobserve();
    this._targets.clear();
  }
}

/** Normalize an observe target — React/framework refs arrive adopted
 *  (ProxyElement) already, but a raw HostInstance record reached through a
 *  portal/instance lookup adopts on the spot. Anything else can't be
 *  measured. */
const toProxyElement = (doc: InternalDocument, target: unknown): ProxyElement | null => {
  if (target instanceof ProxyElement) return target;
  if (
    target !== null &&
    typeof target === 'object' &&
    (target as HostInstance).kind === 'element'
  ) {
    const adopted = doc.adopt(target as HostInstance);
    return adopted instanceof ProxyElement ? adopted : null;
  }
  return null;
};

/** The per-push entry: measured box as contentRect plus the *BoxSize
 *  triple libraries feature-probe for. `target` is the proxy element so
 *  handlers can correlate against their own refs. */
const entryFor = (el: ProxyElement, rect: MeasuredRect): Record<string, unknown> => ({
  target: el,
  contentRect: {
    x: rect.x,
    y: rect.y,
    top: rect.y,
    left: rect.x,
    right: rect.x + rect.w,
    bottom: rect.y + rect.h,
    width: rect.w,
    height: rect.h,
    toJSON: () => ({}),
  },
  borderBoxSize: [{ inlineSize: rect.w, blockSize: rect.h }],
  contentBoxSize: [{ inlineSize: rect.w, blockSize: rect.h }],
  devicePixelContentBoxSize: [{ inlineSize: rect.w, blockSize: rect.h }],
});
