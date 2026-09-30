<script setup lang="ts">
/**
 * 'counter' — the docs' canonical Vue island as an SFC: a `label` wire
 * prop, a local `ref` count, a delegated click that re-renders, and an
 * 'incremented' emit for the shell's status line. Vue's createRenderer is
 * bound to the instance's proxy DOM — this component runs entirely in the
 * worker.
 */
import { ref } from 'vue';
import { emit } from '@atolljs/vue-island/worker';

const props = withDefaults(defineProps<{ label?: string }>(), { label: 'count' });
const count = ref(0);
const bump = (): void => {
  count.value += 1;
  emit('incremented', { count: count.value, label: props.label });
};
</script>

<template>
  <div class="vue-counter">
    <span class="vanilla-heading">{{ label }}: {{ count }}</span>
    <button class="mw-btn" @click="bump">increment</button>
  </div>
</template>
