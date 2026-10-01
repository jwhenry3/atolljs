<script setup lang="ts">
/**
 * 'notes' — a notes composer SFC running inside the worker. Vue's
 * createRenderer is bound to the instance's proxy DOM; `emit` rides the
 * island's event channel back to whatever shell mounted it.
 */
import { ref } from 'vue';
import { emit } from '@atolljs/vue-island/worker';

const props = withDefaults(defineProps<{ title?: string }>(), { title: 'vue mfe' });
const draft = ref('');
const notes = ref<string[]>([]);
const add = (): void => {
  const text = draft.value.trim();
  if (text === '') return;
  notes.value.push(text);
  draft.value = '';
  emit('noteAdded', { text, total: notes.value.length });
};
</script>

<template>
  <div class="mfe-card">
    <h3 class="mfe-heading">{{ props.title }}</h3>
    <div class="mfe-row">
      <input v-model="draft" placeholder="write a note…" @keydown.enter="add" />
      <button class="mfe-btn" @click="add">add</button>
    </div>
    <ul class="mfe-list">
      <li v-for="(n, i) in notes" :key="i" class="mfe-list-line">{{ n }}</li>
    </ul>
    <div class="mfe-readout">{{ notes.length }} note(s) — Vue state lives in the worker</div>
  </div>
</template>
