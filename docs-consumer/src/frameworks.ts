export interface FrameworkDoc {
  id: string;
  name: string;
  port: number;
  pkg: string;
  install: string;
  summary: string;
  apis: { name: string; signature: string; desc: string }[];
  usage: string;
  usageFile: string;
  usageLanguage: string;
  notes: string[];
}

export const FRAMEWORKS: FrameworkDoc[] = [
  {
    id: 'react',
    name: 'React',
    port: 5173,
    pkg: '@jwhenry123/mesh-react',
    install: 'npm install @jwhenry123/mesh @jwhenry123/mesh-react',
    summary:
      'Hooks over useSyncExternalStore. SSR-safe — field reads return undefined until the contract binds on the client.',
    apis: [
      { name: 'useObservable', signature: 'useObservable(source: ObservableValue<T>): T', desc: 'Subscribe to any observable snapshot (task or field).' },
      { name: 'useSharedValue', signature: 'useSharedValue(memory, key, select?, options?): T | undefined', desc: 'Bind one shared-memory field to React state; optional selector + equality to slice updates.' },
      { name: 'useTask', signature: 'useTask(task): { data, pending, settled, elapsedMs, error, run, runOnce }', desc: 'Bind an AsyncTask to state and get its triggers.' },
    ],
    usageFile: 'App.tsx',
    usageLanguage: 'tsx',
    usage: `import { useSharedValue, useTask } from '@jwhenry123/mesh-react';
import { counterMemory, incrementTask, initTask } from './counter.contract';

export function App() {
  const count = useSharedValue(counterMemory, 'count');
  const init = useTask(initTask);
  const increment = useTask(incrementTask);

  useEffect(() => init.runOnce(), []);
  return (
    <button disabled={!init.settled} onClick={() => increment.run(1)}>
      count: {count ?? '…'}
    </button>
  );
}`,
    notes: [
      'runOnce() makes the init task StrictMode-safe — double mounts skip a second run.',
      'Pass a selector to useSharedValue to re-render only when a slice changes: useSharedValue(memory, \'metrics\', m => m.total, { equals: shallowEqual }).',
    ],
  },
  {
    id: 'vue',
    name: 'Vue',
    port: 5174,
    pkg: '@jwhenry123/mesh-vue',
    install: 'npm install @jwhenry123/mesh @jwhenry123/mesh-vue',
    summary:
      'Composables producing Refs. Subscriptions release via onScopeDispose when the component unmounts.',
    apis: [
      { name: 'useObservable', signature: 'useObservable(source: ObservableValue<T>): Ref<T>', desc: 'Subscribe to any observable snapshot.' },
      { name: 'useSharedValue', signature: 'useSharedValue(memory, key, select?, options?): Ref<T | undefined>', desc: 'Bind one shared-memory field to a Ref; optional selector + equality.' },
      { name: 'useTask', signature: 'useTask(task): { state: Ref<TaskSnapshot>, run, runOnce }', desc: 'Bind an AsyncTask to a Ref and get its triggers.' },
    ],
    usageFile: 'App.vue',
    usageLanguage: 'vue',
    usage: `<script setup lang="ts">
import { onMounted } from 'vue';
import { useSharedValue, useTask } from '@jwhenry123/mesh-vue';
import { counterMemory, incrementTask, initTask } from './counter.contract';

const count = useSharedValue(counterMemory, 'count');
const init = useTask(initTask);
const increment = useTask(incrementTask);
onMounted(() => init.runOnce());
</script>

<template>
  <button :disabled="!init.state.value.settled" @click="increment.run(1)">
    count: {{ count ?? '…' }}
  </button>
</template>`,
    notes: ['watch() the task\'s settled Ref to trigger follow-up work after init.'],
  },
  {
    id: 'solid',
    name: 'SolidJS',
    port: 5175,
    pkg: '@jwhenry123/mesh-solidjs',
    install: 'npm install @jwhenry123/mesh @jwhenry123/mesh-solidjs',
    summary:
      'Signal adapter — the sdk uses solid-js internally for its reactive core, so shared values are natively tracked.',
    apis: [
      { name: 'createObservable', signature: 'createObservable(source: ObservableValue<T>): Accessor<T>', desc: 'Subscribe to any observable snapshot.' },
      { name: 'createSharedValue', signature: 'createSharedValue(memory, key, select?, options?): Accessor<T | undefined>', desc: 'Bind one shared-memory field to an Accessor; optional selector + equality.' },
      { name: 'createTask', signature: 'createTask(task): { state: Accessor<TaskSnapshot>, run, runOnce }', desc: 'Bind an AsyncTask to a signal and get its triggers.' },
    ],
    usageFile: 'App.tsx',
    usageLanguage: 'tsx',
    usage: `import { createSharedValue, createTask } from '@jwhenry123/mesh-solidjs';
import { counterMemory, incrementTask, initTask } from './counter.contract';

export function App() {
  const count = createSharedValue(counterMemory, 'count');
  const init = createTask(initTask);
  const increment = createTask(incrementTask);
  init.runOnce();

  return (
    <button disabled={!init.state().settled} onClick={() => increment.run(1)}>
      count: {count() ?? '…'}
    </button>
  );
}`,
    notes: ['Subscriptions auto-dispose via onCleanup when the owner is destroyed.'],
  },
  {
    id: 'svelte',
    name: 'Svelte',
    port: 5176,
    pkg: '@jwhenry123/mesh-svelte',
    install: 'npm install @jwhenry123/mesh @jwhenry123/mesh-svelte',
    summary:
      'Svelte 5 runes adapter. Call the factories during component init; teardown happens in an $effect cleanup.',
    apis: [
      { name: 'observableValue', signature: 'observableValue(source): { value: T }', desc: 'Subscribe to any observable snapshot as rune-backed state.' },
      { name: 'sharedValue', signature: 'sharedValue(memory, key, select?, options?): { value: T | undefined }', desc: 'Bind one shared-memory field as rune state; optional selector + equality.' },
      { name: 'taskState', signature: 'taskState(task): { data, pending, settled, elapsedMs, error, run, runOnce }', desc: 'Bind an AsyncTask — snapshot getters plus triggers.' },
    ],
    usageFile: 'App.svelte',
    usageLanguage: 'svelte',
    usage: `<script lang="ts">
  import { sharedValue, taskState } from '@jwhenry123/mesh-svelte';
  import { counterMemory, incrementTask, initTask } from './counter.contract';

  const count = sharedValue(counterMemory, 'count');
  const init = taskState(initTask);
  const increment = taskState(incrementTask);
  init.runOnce();
</script>

<button disabled={!init.settled} onclick={() => increment.run(1)}>
  count: {count.value ?? '…'}
</button>`,
    notes: ['Factories must run in a .svelte.ts module or during component init so runes compile correctly.'],
  },
  {
    id: 'angular',
    name: 'Angular',
    port: 4201,
    pkg: '@jwhenry123/mesh-angular',
    install: 'npm install @jwhenry123/mesh @jwhenry123/mesh-angular',
    summary:
      'Signal adapter for zoneless Angular. Call in an injection context (field initializer or constructor) so subscriptions release on destroy.',
    apis: [
      { name: 'observableSignal', signature: 'observableSignal(source: ObservableValue<T>): Signal<T>', desc: 'Subscribe to any observable snapshot.' },
      { name: 'sharedValue', signature: 'sharedValue(memory, key, select?, options?): Signal<T | undefined>', desc: 'Bind one shared-memory field to a Signal; optional selector + equality.' },
      { name: 'taskState', signature: 'taskState(task): { state: Signal<TaskSnapshot>, run, runOnce }', desc: 'Bind an AsyncTask to a Signal and get its triggers.' },
    ],
    usageFile: 'app.component.ts',
    usageLanguage: 'typescript',
    usage: `import { Component, effect } from '@angular/core';
import { sharedValue, taskState } from '@jwhenry123/mesh-angular';
import { counterMemory, incrementTask, initTask } from './counter.contract';

@Component({
  selector: 'app-root',
  template: \`<button [disabled]="!init().settled" (click)="increment.run(1)">
    count: {{ count() ?? '…' }}</button>\`,
})
export class AppComponent {
  count = sharedValue(counterMemory, 'count');
  init = taskState(initTask).state;
  increment = taskState(incrementTask);

  constructor() {
    initTask.runOnce();
    effect(() => console.log('count →', this.count()));
  }
}`,
    notes: ['Works with OnPush + zoneless change detection out of the box.'],
  },
];
