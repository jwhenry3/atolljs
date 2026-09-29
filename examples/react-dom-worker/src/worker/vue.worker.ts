/**
 * Vue island worker — a registry worker serving Vue apps through
 * `vueIslandApp` (Vue's createRenderer bound to the instance's proxy DOM).
 * Its bundle carries Vue but no React — the point of the demo: islands are
 * framework-agnostic over one op protocol.
 *
 * Components are `h()`/`defineComponent`-authored — this example has no SFC
 * plugin configured; `.vue` single-file components work when the consumer's
 * vite config adds @vitejs/plugin-vue.
 */
import { defineComponent, h, ref } from 'vue';
import { defineVuePolyWorker, emit } from '@jwhenry123/mesh-vue-island/worker';

/**
 * 'vue-notes' — a tiny notes composer: input + add button + list. State
 * lives worker-side; every keystroke/add is a dispatch round-trip, and each
 * added note also emits 'noteAdded' for the shell status line.
 */
const Notes = defineComponent({
  name: 'VueNotes',
  props: { title: { type: String, default: 'vue island' } },
  setup(props) {
    const draft = ref('');
    const notes = ref<string[]>([]);
    const add = (): void => {
      const text = draft.value.trim();
      if (text === '') return;
      notes.value = [...notes.value, text];
      draft.value = '';
      emit('noteAdded', { text, total: notes.value.length });
    };
    return () =>
      h('div', { class: 'vue-notes' }, [
        h('h3', { class: 'vanilla-heading' }, props.title),
        h('div', { class: 'mesh-map-places' }, [
          h('input', {
            placeholder: 'write a note…',
            value: draft.value,
            // The DOM idiom works: _enrichEvent stamps the wire payload's
            // `value` onto the wrapped target's shadow attrs, so
            // e.target.value reads what the user had typed at dispatch.
            onInput: (e: Event) => {
              draft.value = (e.target as HTMLInputElement).value;
            },
            onKeydown: (e: KeyboardEvent) => {
              if (e.key === 'Enter') add();
            },
          }),
          h('button', { class: 'mesh-map-place-btn', onClick: add }, 'add'),
        ]),
        h(
          'ul',
          { class: 'vanilla-log' },
          notes.value.map((n, i) =>
            h('li', { class: 'vanilla-log-line', key: i }, n),
          ),
        ),
        h('div', { class: 'vanilla-readout' }, `${notes.value.length} note(s) — state lives in the worker`),
      ]);
  },
});

export const vueWorker = defineVuePolyWorker({
  apps: { 'vue-notes': Notes },
});
