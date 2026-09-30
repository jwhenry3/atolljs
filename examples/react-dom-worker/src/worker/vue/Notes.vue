<script setup lang="ts">
/**
 * 'vue-notes' — a tiny notes composer as an SFC: input + add button +
 * v-for list. State lives worker-side; every keystroke/add is a dispatch
 * round-trip, and each added note also emits 'noteAdded' for the shell
 * status line.
 */
import { ref } from 'vue';
import { emit } from '@atolljs/vue-island/worker';

withDefaults(defineProps<{ title?: string }>(), { title: 'vue island' });
const draft = ref('');
const notes = ref<string[]>([]);

const add = (): void => {
  const text = draft.value.trim();
  if (text === '') return;
  notes.value = [...notes.value, text];
  draft.value = '';
  emit('noteAdded', { text, total: notes.value.length });
};

// The DOM idiom works: _enrichEvent stamps the wire payload's `value` onto
// the wrapped target's shadow attrs, so e.target.value reads what the
// user had typed at dispatch.
const onInput = (e: Event): void => {
  draft.value = (e.target as HTMLInputElement).value;
};
const onKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Enter') add();
};
</script>

<template>
  <div class="vue-notes">
    <h3 class="vanilla-heading">{{ title }}</h3>
    <div class="atoll-map-places">
      <input
        placeholder="write a note…"
        :value="draft"
        @input="onInput"
        @keydown="onKeydown"
      />
      <button class="atoll-map-place-btn" @click="add">add</button>
    </div>
    <ul class="vanilla-log">
      <li v-for="(n, i) in notes" :key="i" class="vanilla-log-line">{{ n }}</li>
    </ul>
    <div class="vanilla-readout">{{ notes.length }} note(s) — state lives in the worker</div>
  </div>
</template>
