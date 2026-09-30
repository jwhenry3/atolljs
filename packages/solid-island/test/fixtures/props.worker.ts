/**
 * Island worker entry for the prop-surface suite — a REGISTRY worker
 * (defineSolidPolyWorker) serving plain-function components that drive the
 * universal renderer's `setProperty` map, the `wireProps` proxy traps, and
 * every hand-authoring primitive the package exports:
 *
 * - `propkit`: `spread()` over a computed props object so `updateProps`
 *   arrives as `setProperty(el, name, next, prev)` with real prev values —
 *   attribute/bool/prop/use prefixes, style/class/classList diffs,
 *   textContent/innerText/innerHTML, `on:`/`onX` rebinding, `ref`/
 *   `children`/`key` special cases, and a post-task deferred node that
 *   resolves its document through the ambient fallbacks.
 * - `keyprobe`: the wire-props proxy — `has`/`ownKeys`/
 *   `getOwnPropertyDescriptor` traps, the write-swallowing `set` trap, and
 *   key REMOVAL on updateProps.
 * - `toolkit`: the exported factories — createElement/createTextNode/
 *   insertNode/setProp/render/createComponent/memo/use/mergeProps/effect.
 */
import { emit, renderMemory } from '@atolljs/islands/worker';
import {
  createComponent,
  createElement,
  createTextNode,
  defineSolidPolyWorker,
  effect,
  h,
  insert,
  insertNode,
  memo,
  mergeProps,
  render,
  setProp,
  spread,
  use,
} from '../../src/worker';

/* ── propkit ──────────────────────────────────────────────────────────── */

const clickBase = (): void => emit('click-base', {});
const clickAlt = (): void => emit('click-alt', {});
const customBase = (): void => emit('custom-base', {});
const customAlt = (): void => emit('custom-alt', {});

function PropKit(props: Record<string, unknown>): ReturnType<typeof h> {
  // Attributes + prefixes — every branch of writeAttr/setProperty gets a
  // prop, and spread() supplies the `prev` argument on re-patches.
  // data-pk marker survives the `class` prop — spread's class write
  // REPLACES className, so the queryable marker lives in an attribute.
  const attrs = h('div', { class: 'pk-attrs', 'data-pk': 'attrs' });
  spread(attrs, () => ({
    title: props.title, // plain attr → writeAttr string/number/remove
    'data-count': props.count,
    'attr:aria-label': props.aria, // attr: prefix
    'attr:aria-pressed': props.pressed, // writeAttr's `true` → 'true' branch
    onBogus: props.bogus, // onX with callbackProp'd / non-function values
    'bool:hidden': props.hidden, // bool: presence-attribute write/remove
    'prop:tagline': props.tagline, // prop: expando (no wire encoding)
    'use:tracking': props.track, // use: directive-arg expando
    'data-obj': props.obj, // object value → writeAttr drops it
    class: props.cls, // class write, '' on null/false
  }));

  // classList object diff + `classList:` single-toggle + `className` alias.
  const classy = h('div', { class: 'pk-classy' });
  spread(classy, () => ({
    classList: props.list,
    'classList:featured': props.featured,
  }));
  // className replaces the whole class — keep the marker inside the value
  // so the element stays queryable across updates.
  const cnamed = h('div', { class: 'pk-cnamed' });
  spread(cnamed, () => ({ className: `pk-cnamed ${String(props.cname ?? '')}` }));

  // style object/string/false + `style:` single-key write.
  const styled = h('div', { class: 'pk-styled' });
  spread(styled, () => ({ style: props.sty, 'style:borderWidth': props.bw }));

  // Facade properties.
  const txt = h('div', { class: 'pk-text' });
  spread(txt, () => ({ textContent: props.text }));
  const itxt = h('div', { class: 'pk-itext' });
  spread(itxt, () => ({ innerText: props.itext }));
  const html = h('div', { class: 'pk-html' });
  spread(html, () => ({ innerHTML: props.html }));

  // `on:` and `onX` handlers selected by a wire prop — a props flip is a
  // REAL rebind: prev is a different function → removeEventListener runs.
  const btn = h('button', { class: 'pk-btn' }, 'hit');
  spread(btn, () => ({
    'on:click': props.alt === true ? clickAlt : clickBase,
    onCustom: props.alt === true ? customAlt : customBase,
  }));

  // `ref` invokes the callback with the element; `children`/`key` are
  // ignored by setProperty outright.
  const reffed = h('div', {
    class: 'pk-ref',
    ref: () => emit('ref-claimed', {}),
    children: 'ignored',
    key: 'k1',
  });

  // Marker-anchored text insert — the universal inserter's `multi` path:
  // isTextNode(current[0]) → replaceText on update, text inserted before
  // the marker.
  const anchored = h('div', { class: 'pk-anchor' });
  const marker = h('span', { class: 'pk-marker' }, 'mk');
  insertNode(anchored, marker);
  insert(anchored, () => `dyn:${String(props.dyn)}`, marker);

  // Post-task work — a promise continuation resolves its document through
  // the lastActive fallback (no instance is active outside tasks) and its
  // ops still route to this instance's queue.
  const lateHost = h('div', { class: 'pk-latehost' });
  void Promise.resolve().then(() => {
    const late = h('span', { class: 'pk-late' }, 'late');
    insertNode(lateHost, late);
  });

  return h(
    'div',
    { class: 'propkit' },
    attrs,
    classy,
    cnamed,
    styled,
    txt,
    itxt,
    html,
    btn,
    reffed,
    anchored,
    lateHost,
  );
}

/* ── keyprobe ─────────────────────────────────────────────────────────── */

function KeyProbe(props: Record<string, unknown>): ReturnType<typeof h> {
  // Props are read-only — the proxy's `set` trap swallows this instead of
  // throwing into component code that believed it owned a plain object.
  (props as Record<string, unknown>).smuggled = 'nope';
  const probe = h('span', { class: 'kp' });
  insert(probe, () => {
    // `has`, `ownKeys` + `getOwnPropertyDescriptor` + `get` traps — the
    // rendered string changes when updateProps adds/removes keys.
    const has = 'opt' in props ? 'y' : 'n';
    const keys = Object.keys(props).sort().join(',');
    const opt = props.opt === undefined ? 'u' : String(props.opt);
    return `${has}|${keys}|${opt}`;
  });
  return h('div', { class: 'keyprobe' }, probe);
}

/* ── toolkit ──────────────────────────────────────────────────────────── */

function Inner(props: Record<string, unknown>): ReturnType<typeof h> {
  const b = h('b', { class: 'inner' });
  insert(b, () => `in:${String(props.tag)}`);
  return b;
}

function Toolkit(props: Record<string, unknown>): ReturnType<typeof h> {
  const el = createElement('span'); // exported factory → currentDoc()
  setProp(el, 'class', 'made'); // exported setProp → setProperty
  insertNode(el, createTextNode(`made:${String(props.tag)}`)); // exported pair

  // `onClick` re-set with identical prev — deduped by eventRebind AND by
  // the proxy's own (type, fn, capture) listener dedupe.
  const noop = (): void => emit('tool-click', {});
  setProp(el, 'onClick', noop);
  setProp(el, 'onClick', noop, noop);

  // use(fn, el, arg) — the compiled-directive helper.
  use(
    (node, arg) => {
      (node as typeof el).setAttribute('data-arg', String(arg));
      return arg;
    },
    el,
    'u1',
  );

  // effect — a tracked render effect writing a reflected attribute.
  effect(() => {
    el.setAttribute('data-eff', String(props.tag));
  });

  // memo + insert of a tracked accessor — updates with the wire prop.
  const doubled = memo(() => `${String(props.tag)}+${String(props.tag)}`);
  const memoEl = h('i', { class: 'memo' });
  insert(memoEl, () => doubled());

  // mergeProps — rightmost defined wins. The wire-props descriptors are
  // real accessors, so mergeProps' static path resolves live values and
  // the component prop wins — same as the {...props} snapshot.
  const merged = mergeProps({ tag: 'd', side: 'L' }, props);
  const mergedEl = h('u', { class: 'merged' }, `m:${String(merged.tag)}:${String(merged.side)}`);
  const mergedB = mergeProps({ tag: 'd', side: 'L' }, { ...props });
  const mergedElB = h(
    'u',
    { class: 'mergedB' },
    `m2:${String(mergedB.tag)}:${String(mergedB.side)}`,
  );

  // render() + createComponent — mount a nested component under a host.
  const host = h('div', { class: 'host' });
  render(() => createComponent(Inner, props) as ReturnType<typeof h>, host);

  return h('div', { class: 'toolkit' }, el, memoEl, mergedEl, mergedElB, host);
}

export const propsWorker = defineSolidPolyWorker({
  apps: {
    propkit: PropKit,
    keyprobe: KeyProbe,
    toolkit: Toolkit,
  },
  // Explicit doorbell contract — same spec the default uses; covers the
  // registry-sharedMemory override branch.
  sharedMemory: renderMemory,
});
