/**
 * Island worker entry for the Vue renderer test — a registry worker serving
 * one Vue app: a div with a button that bumps a `ref` (proving the
 * dispatch → re-render → ops round trip through the real op path) and calls
 * the islands `emit()` inside the handler (proving the emit op reaches
 * the island's `onEvent`). Plain `h()`/`defineComponent` — no SFC compiler.
 */
import {
  createStaticVNode,
  defineComponent,
  h,
  ref,
  Teleport,
  vModelCheckbox,
  vModelText,
  withDirectives,
} from 'vue';
import { definePolyWorker, emit } from '@jwhenry123/mesh-islands/worker';
import { vueIslandApp } from '../../src/worker';

const Counter = defineComponent({
  name: 'VueCounter',
  props: { label: { type: String, default: 'count' } },
  setup(props) {
    const count = ref(0);
    return () =>
      h('div', { class: 'counter' }, [
        h(
          'button',
          {
            class: 'inc',
            onClick: () => {
              count.value += 1;
              // Inside the dispatch task's instance scope — the emit op rides
              // back in the same op batch and lands on onEvent.
              emit('incremented', { count: count.value });
            },
          },
          '+',
        ),
        h('span', { class: 'value' }, `${props.label}: ${count.value}`),
      ]);
  },
});

/**
 * A second app for the new proxy-DOM primitives: a `onClickOnce` listener
 * (event modifier options riding the listen op's `opts`, auto-detaching
 * after one dispatch) and a `show` prop gating a conditional child — the
 * false branch mounts a comment anchor (nodeType 8 ProxyComment, an empty
 * text node driver-side) that a true→false→true toggle must route
 * insert/remove ops around.
 */
const Controls = defineComponent({
  name: 'VueControls',
  props: { show: { type: Boolean, default: false } },
  setup(props) {
    const onceCount = ref(0);
    return () =>
      h('div', { class: 'controls' }, [
        h(
          'button',
          {
            class: 'once',
            onClickOnce: () => {
              onceCount.value += 1;
            },
          },
          'once',
        ),
        h('span', { class: 'once-value' }, `once: ${onceCount.value}`),
        props.show ? h('span', { class: 'branch' }, 'shown') : null,
        h('span', { class: 'stable' }, 'stable'),
      ]);
  },
});

/**
 * Static content — what compiled `v-once`/hoisted nodes produce: a
 * `createStaticVNode` HTML string the renderer must land via
 * `insertStaticContent` (template.innerHTML → move children) as real DOM.
 */
const StaticApp = defineComponent({
  name: 'VueStatic',
  setup() {
    return () =>
      h('div', { class: 'static-app' }, [
        createStaticVNode('<b class="frozen">never re-renders</b><i class="also-frozen">two</i>', 2),
        h('span', { class: 'live' }, 'live sibling'),
      ]);
  },
});

/**
 * v-model, hand-compiled: `<input v-model="text">` produces exactly this
 * shape — an `onUpdate:modelValue` vnode prop (skipped by patchProp, same
 * as runtime-dom) + a `vModelText`/`vModelCheckbox` directive that attaches
 * input/change listeners and assigns back through `el._assign`.
 */
const VModelApp = defineComponent({
  name: 'VueVModel',
  setup() {
    const text = ref('initial');
    const checked = ref(false);
    return () =>
      h('div', { class: 'vmodel' }, [
        withDirectives(
          h('input', {
            class: 'text-in',
            'onUpdate:modelValue': (v: string) => (text.value = v),
          }),
          [[vModelText, text.value]],
        ),
        withDirectives(
          h('input', {
            class: 'check-in',
            type: 'checkbox',
            'onUpdate:modelValue': (v: boolean) => (checked.value = v),
          }),
          [[vModelCheckbox, checked.value]],
        ),
        h('span', { class: 'echo' }, `${text.value}:${checked.value}`),
      ]);
  },
});

/**
 * Teleport to the instance's body — `to` resolves through the renderer's
 * querySelector host op against the instance's shadow tree. (Same as the real
 * DOM: the target must exist outside the mounting subtree, so 'body' —
 * the island root — is the in-island target.)
 */
const TeleportApp = defineComponent({
  name: 'VueTeleport',
  setup() {
    return () =>
      h('div', { class: 'tele-app' }, [
        h(Teleport, { to: 'body' }, [h('b', { class: 'beamed' }, 'beamed in')]),
        h('span', { class: 'after' }, 'anchor sibling'),
      ]);
  },
});

export const counterWorker = definePolyWorker({
  apps: {
    counter: vueIslandApp(Counter),
    controls: vueIslandApp(Controls),
    static: vueIslandApp(StaticApp),
    vmodel: vueIslandApp(VModelApp),
    teleport: vueIslandApp(TeleportApp),
  },
});
