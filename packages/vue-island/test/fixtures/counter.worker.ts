/**
 * Island worker entry for the Vue renderer test — a registry worker serving
 * one Vue app: a div with a button that bumps a `ref` (proving the
 * dispatch → re-render → ops round trip through the real op path) and calls
 * the worker-dom `emit()` inside the handler (proving the emit op reaches
 * the island's `onEvent`). Plain `h()`/`defineComponent` — no SFC compiler.
 */
import { createStaticVNode, defineComponent, h, ref } from 'vue';
import { defineIslandWorker, emit } from '@jwhenry123/mesh-worker-dom/worker';
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
              // Inside the dispatch task's realm scope — the emit op rides
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

export const counterWorker = defineIslandWorker({
  apps: {
    counter: vueIslandApp(Counter),
    controls: vueIslandApp(Controls),
    static: vueIslandApp(StaticApp),
  },
});
