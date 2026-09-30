/**
 * Island worker entry for the Vue-renderer surface suite — a registry
 * worker (defineVuePolyWorker) whose apps exercise the host-op surface the
 * counter fixture doesn't reach:
 *
 * - `events`: `patchEvent`'s invoker table — same-binding handler swaps,
 *   array handlers, modifier-suffix changes (onClick ↔ onClickOnce ↔
 *   onClickCapture ↔ onClickOnceCapture) claiming the same event name,
 *   null-removal guarded by rawKey ownership, and 'on:x' colon events.
 * - `surface`: `patchStyle` object/string/removal/array/custom-prop forms,
 *   normalizeClass variants, innerHTML/textContent facade writes,
 *   FORM_PROPS reflected accessors vs attribute fallthrough, and the
 *   bare-attribute patchProp tail (true → '', null/false → remove).
 * - `markup`: svg/mathml namespaces, scope-id attributes, keyed-list
 *   reorder through parentNode/nextSibling, comment-anchored branches,
 *   text-vnode setText vs element setElementText.
 * - `staticmove`: a retained static vnode toggled off and on — the second
 *   mount re-inserts the cached [start, end] sibling range (the
 *   insertStaticContent move path).
 */
import { createStaticVNode, defineComponent, h, type VNode } from 'vue';
import { emit, renderMemory } from '@atolljs/islands/worker';
import { defineVuePolyWorker } from '../../src/worker';

type Cb = (...args: unknown[]) => void;

/* ── events ───────────────────────────────────────────────────────────── */

const EventsApp = defineComponent({
  name: 'VueEvents',
  props: {
    hit: { type: Function, default: undefined }, // callbackProp'd handler
    mode: { type: String, default: 'plain' }, // plain|once|capture|oncecap
    multi: { type: Boolean, default: false },
  },
  setup(props) {
    return () => {
      const p: Record<string, unknown> = { class: 'ev-btn' };
      if (props.hit) {
        // Array handlers dispatch every entry through the one invoker.
        p.onClick = props.multi
          ? [props.hit as Cb, () => emit('multi-extra', {})]
          : props.hit;
      }
      // Modifier bindings are DIFFERENT listeners on the same event name —
      // adding one detaches the stale invoker before the listen op goes out.
      if (props.mode === 'once') p.onClickOnce = () => emit('once-fired', {});
      if (props.mode === 'capture') p.onClickCapture = () => emit('capture-fired', {});
      if (props.mode === 'oncecap')
        p.onClickOnceCapture = () => emit('once-capture-fired', {});
      // 'on:colon' — the colon-name branch of parseEventName.
      p['on:colon'] = () => emit('colon-fired', {});
      return h('button', p, 'hit');
    };
  },
});

/* ── surface ──────────────────────────────────────────────────────────── */

const SurfaceApp = defineComponent({
  name: 'VueSurface',
  props: {
    cls: { type: [String, Object, Array], default: 'a' },
    sty: { type: [String, Object], default: undefined },
    txt: { type: String, default: 't0' },
    html: { type: String, default: '<b>h0</b>' },
    val: { type: String, default: 'v0' },
    box: { type: Boolean, default: false },
    dis: { type: Boolean, default: false },
    sel: { type: Boolean, default: false },
    flag: { type: Boolean, default: undefined },
    zap: { type: [String, Number, Boolean, Object], default: 'z' },
  },
  setup(props) {
    return () =>
      h('div', { class: 'surface' }, [
        h('div', { class: props.cls, style: props.sty as never }, 'styled'),
        h('div', { class: 's-html', innerHTML: props.html }),
        h('div', { class: 's-txt', textContent: props.txt }),
        // FORM_PROPS: value/checked/disabled are reflected accessors on the
        // proxy; `selected` is not — it falls through to the attribute path.
        h('input', {
          class: 's-in',
          value: props.val,
          checked: props.box,
          disabled: props.dis,
          selected: props.sel,
        }),
        // Bare-attribute tail: true → '', null/false → remove; `onlower`
        // (not /^on[A-Z]/) lands here as a plain attribute too.
        h('i', {
          class: 's-flag',
          'data-flag': props.flag,
          'data-zap': props.zap,
          onlower: 'lo',
        }),
      ]);
  },
});

/* ── markup ───────────────────────────────────────────────────────────── */

const MarkupApp = defineComponent({
  name: 'VueMarkup',
  // The SFC compiler's scope-id stamp — withScopeId only forwards withCtx,
  // which resolves the id from `instance.type.__scopeId`, so the component
  // itself must carry the stamp for vnodes to get `data-v-smk` attrs.
  __scopeId: 'data-v-smk',
  props: {
    items: { type: Array, default: () => ['x', 'y', 'z'] },
    mid: { type: Boolean, default: true },
    t: { type: String, default: 'a' },
  },
  setup: (props) => () =>
      h('div', { class: 'markup' }, [
        h('svg', { class: 'mk-svg' }, [h('circle', { class: 'mk-circle', r: 4 })]),
        h('math', { class: 'mk-math' }, [h('mi', 'm')]),
        h(
          'ul',
          { class: 'mk-list' },
          (props.items as string[]).map((it) => h('li', { key: it }, `i-${it}`)),
        ),
        // Comment-anchored branch + a trailing stable sibling.
        props.mid ? h('b', { class: 'mk-mid' }, 'mid') : null,
        h('span', { class: 'mk-stable' }, 'stable'),
        // setElementText (text-only children) vs setText (text vnode in a
        // mixed sibling list).
        h('div', { class: 'mk-text' }, `text-only:${props.t}`),
        h('div', { class: 'mk-mixed' }, [h('u', 'u'), `text-node:${props.t}`]),
      ]),
});

/* ── staticmove ───────────────────────────────────────────────────────── */

// Retained ACROSS renders — mount #1 parses the HTML string; unmount keeps
// the vnode's el/anchor refs but detaches the sibling chain; mount #2's
// [start, end] branch sees the broken chain and re-parses the content.
const retainedStatic = createStaticVNode(
  '<b class="sm-b">S1</b><i class="sm-i">S2</i>',
  2,
) as VNode;

const StaticMoveApp = defineComponent({
  name: 'VueStaticMove',
  props: {
    on: { type: Boolean, default: true },
    ver: { type: Number, default: 1 },
  },
  setup(props) {
    return () =>
      h('div', { class: 'sm' }, [
        props.on ? retainedStatic : null,
        // A second static vnode whose content string CHANGES per update —
        // patchStaticNode's remove+reparse path.
        createStaticVNode(`<u class="sm-v">v${props.ver}</u>`, 1),
        h('span', { class: 'sm-anchor' }, 'anchor'),
      ]);
  },
});

export const surfaceWorker = defineVuePolyWorker({
  apps: {
    events: EventsApp,
    surface: SurfaceApp,
    markup: MarkupApp,
    staticmove: StaticMoveApp,
  },
  // Explicit doorbell contract — same spec as the default; covers the
  // registry-sharedMemory override branch.
  sharedMemory: renderMemory,
});
