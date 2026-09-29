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
    pkg: '@atolljs/react',
    install: 'npm install @atolljs/core @atolljs/react',
    summary:
      'Hooks over useSyncExternalStore. SSR-safe — field reads return undefined until the contract binds on the client.',
    apis: [
      { name: 'useObservable', signature: 'useObservable(source: ObservableValue<T>): T', desc: 'Subscribe to any observable snapshot (task or field).' },
      { name: 'useSharedValue', signature: 'useSharedValue(memory, key, select?, options?): T | undefined', desc: 'Bind one shared-memory field to React state; optional selector + equality to slice updates.' },
      { name: 'useTask', signature: 'useTask(task | asyncFn): { data, pending, settled, elapsedMs, error, run, runOnce }', desc: 'Bind an AsyncTask — or any async fn (e.g. a client method, wrapped via toTask) — to state and get its triggers.' },
    ],
    usageFile: 'App.tsx',
    usageLanguage: 'tsx',
    usage: `import { useSharedValue, useTask } from '@atolljs/react';
import { counterMemory } from './counter.memory';
import { counter } from './counter';

export function App() {
  const count = useSharedValue(counterMemory, 'count');
  const increment = useTask(counter.increment);  // client method → latest-wins task

  return (
    <button onClick={() => increment.run(1)}>
      count: {count ?? '…'}
    </button>
  );
}`,
    notes: [
      'counter.increment is typed from the worker\'s defineWorker methods — no task contract to declare.',
      'Pass a selector to useSharedValue to re-render only when a slice changes: useSharedValue(memory, \'metrics\', m => m.total, { equals: shallowEqual }).',
      'Worker-hosted React trees (islands) live in the companion package @atolljs/react-island — see the Worker islands page under this section.',
    ],
  },
  {
    id: 'vue',
    name: 'Vue',
    port: 5174,
    pkg: '@atolljs/vue',
    install: 'npm install @atolljs/core @atolljs/vue',
    summary:
      'Composables producing Refs. Subscriptions release via onScopeDispose when the component unmounts.',
    apis: [
      { name: 'useObservable', signature: 'useObservable(source: ObservableValue<T>): Ref<T>', desc: 'Subscribe to any observable snapshot.' },
      { name: 'useSharedValue', signature: 'useSharedValue(memory, key, select?, options?): Ref<T | undefined>', desc: 'Bind one shared-memory field to a Ref; optional selector + equality.' },
      { name: 'useTask', signature: 'useTask(task | asyncFn): { state: Ref<TaskSnapshot>, run, runOnce }', desc: 'Bind an AsyncTask — or any async fn — to a Ref and get its triggers.' },
    ],
    usageFile: 'App.vue',
    usageLanguage: 'vue',
    usage: `<script setup lang="ts">
import { useSharedValue, useTask } from '@atolljs/vue';
import { counterMemory } from './counter.memory';
import { counter } from './counter';

const count = useSharedValue(counterMemory, 'count');
const increment = useTask(counter.increment);
</script>

<template>
  <button @click="increment.run(1)">
    count: {{ count ?? '…' }}
  </button>
</template>`,
    notes: [
      'watch() the task\'s settled Ref to trigger follow-up work after a run.',
      'Worker-hosted Vue trees (islands) live in the companion package @atolljs/vue-island — see the Worker islands page under this section.',
    ],
  },
  {
    id: 'solid',
    name: 'SolidJS',
    port: 5175,
    pkg: '@atolljs/solidjs',
    install: 'npm install @atolljs/core @atolljs/solidjs',
    summary:
      'Signal adapter — the sdk uses solid-js internally for its reactive core, so shared values are natively tracked.',
    apis: [
      { name: 'createObservable', signature: 'createObservable(source: ObservableValue<T>): Accessor<T>', desc: 'Subscribe to any observable snapshot.' },
      { name: 'createSharedValue', signature: 'createSharedValue(memory, key, select?, options?): Accessor<T | undefined>', desc: 'Bind one shared-memory field to an Accessor; optional selector + equality.' },
      { name: 'createTask', signature: 'createTask(task | asyncFn): { state: Accessor<TaskSnapshot>, run, runOnce }', desc: 'Bind an AsyncTask — or any async fn — to a signal and get its triggers.' },
    ],
    usageFile: 'App.tsx',
    usageLanguage: 'tsx',
    usage: `import { createSharedValue, createTask } from '@atolljs/solidjs';
import { counterMemory } from './counter.memory';
import { counter } from './counter';

export function App() {
  const count = createSharedValue(counterMemory, 'count');
  const increment = createTask(counter.increment);

  return (
    <button onClick={() => increment.run(1)}>
      count: {count() ?? '…'}
    </button>
  );
}`,
    notes: [
      'Subscriptions auto-dispose via onCleanup when the owner is destroyed.',
      'Worker-hosted Solid trees (islands) live in the companion package @atolljs/solid-island — see the Worker islands page under this section.',
    ],
  },
  {
    id: 'svelte',
    name: 'Svelte',
    port: 5176,
    pkg: '@atolljs/svelte',
    install: 'npm install @atolljs/core @atolljs/svelte',
    summary:
      'Svelte 5 runes adapter. Call the factories during component init; teardown happens in an $effect cleanup.',
    apis: [
      { name: 'observableValue', signature: 'observableValue(source): { value: T }', desc: 'Subscribe to any observable snapshot as rune-backed state.' },
      { name: 'sharedValue', signature: 'sharedValue(memory, key, select?, options?): { value: T | undefined }', desc: 'Bind one shared-memory field as rune state; optional selector + equality.' },
      { name: 'taskState', signature: 'taskState(task | asyncFn): { data, pending, settled, elapsedMs, error, run, runOnce }', desc: 'Bind an AsyncTask — or any async fn — snapshot getters plus triggers.' },
    ],
    usageFile: 'App.svelte',
    usageLanguage: 'svelte',
    usage: `<script lang="ts">
  import { sharedValue, taskState } from '@atolljs/svelte';
  import { counterMemory } from './counter.memory';
  import { counter } from './counter';

  const count = sharedValue(counterMemory, 'count');
  const increment = taskState(counter.increment);
</script>

<button onclick={() => increment.run(1)}>
  count: {count.value ?? '…'}
</button>`,
    notes: [
      'Factories must run in a .svelte.ts module or during component init so runes compile correctly.',
      'Worker-hosted Svelte trees (islands) live in the companion package @atolljs/svelte-island — see the Worker islands page under this section.',
    ],
  },
  {
    id: 'angular',
    name: 'Angular',
    port: 4201,
    pkg: '@atolljs/angular',
    install: 'npm install @atolljs/core @atolljs/angular',
    summary:
      'Signal adapter for zoneless Angular. Call in an injection context (field initializer or constructor) so subscriptions release on destroy. NgModule apps get the same pools through AtollModule — the NestJS binding\'s forRoot/registerPool vocabulary.',
    apis: [
      { name: 'provideAtoll', signature: 'provideAtoll({ pools: AtollPoolDeclaration[] }, ...features)', desc: 'Register worker pools or connectWorker clients ({ name, client }) as environment providers — terminated on injector destroy; also usable at route level.' },
      { name: 'injectAtollPool', signature: 'injectAtollPool<T>(name): T', desc: 'Inject a pool registered by provideAtoll inside an injection context; mockable via TestBed.' },
      { name: 'AtollModule', signature: 'AtollModule.forRoot({pools?}) / forRootAsync / registerPool(decl) / registerPoolAsync', desc: 'NgModule alternative to provideAtoll — same pool tokens + lifecycle, declared on the importing module; async forms resolve their factory before bootstrap.' },
      { name: 'InjectAtollPool', signature: '@InjectAtollPool(name)', desc: 'Constructor-parameter decorator form of injectAtollPool for @Injectable() classes.' },
      { name: 'observableSignal', signature: 'observableSignal(source: ObservableValue<T>): Signal<T>', desc: 'Subscribe to any observable snapshot.' },
      { name: 'sharedValue', signature: 'sharedValue(memory, key, select?, options?): Signal<T | undefined>', desc: 'Bind one shared-memory field to a Signal; optional selector + equality.' },
      { name: 'taskState', signature: 'taskState(task | asyncFn): { state: Signal<TaskSnapshot>, run, runOnce }', desc: 'Bind an AsyncTask — or any async fn — to a Signal and get its triggers.' },
    ],
    usageFile: 'main.ts + app.component.ts',
    usageLanguage: 'typescript',
    usage: `// main.ts — the connectWorker client registers as a DI provider,
// terminated on app teardown (it re-spawns lazily on the next call)
bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    provideAtoll({ pools: [{ name: 'counter', client: counter }] }),
  ],
});

// app.component.ts
import { Component, effect } from '@angular/core';
import { injectAtollPool, sharedValue, taskState } from '@atolljs/angular';
import { counterMemory } from './counter.memory';
import { counter } from './counter';

@Component({
  selector: 'app-root',
  template: \`<button (click)="increment.run(1)">
    count: {{ count() ?? '…' }}</button>\`,
})
export class AppComponent {
  private readonly counter = injectAtollPool<typeof counter>('counter');
  count = sharedValue(counterMemory, 'count');
  increment = taskState(this.counter.increment);

  constructor() {
    effect(() => console.log('count →', this.count()));
  }
}`,
    notes: [
      'Works with OnPush + zoneless change detection out of the box.',
      'Worker-hosted Angular trees (islands) live in the companion package @atolljs/angular-island — see the Worker islands page under this section.',
    ],
  },
  {
    id: 'nextjs',
    name: 'Next.js',
    port: 3001,
    pkg: '@atolljs/nextjs',
    install: 'npm install @atolljs/core @atolljs/nextjs',
    summary:
      'The React hooks re-exported for App Router apps — same signatures, imported by client components under a \'use client\' boundary.',
    apis: [
      { name: 'useObservable', signature: 'useObservable(source: ObservableValue<T>): T', desc: 'Subscribe to any observable snapshot (task or field).' },
      { name: 'useSharedValue', signature: 'useSharedValue(memory, key, select?, options?): T | undefined', desc: 'Bind one shared-memory field to React state; optional selector + equality to slice updates.' },
      { name: 'useTask', signature: 'useTask(task | asyncFn): { data, pending, settled, elapsedMs, error, run, runOnce }', desc: 'Bind an AsyncTask — or any async fn (e.g. a client method, wrapped via toTask) — to state and get its triggers.' },
    ],
    usageFile: 'components/Counter.tsx — a client component',
    usageLanguage: 'tsx',
    usage: `'use client';   // required — the hooks read browser-side state

import { useSharedValue, useTask } from '@atolljs/nextjs';
import { counterMemory } from '../counter.memory';
import { counter } from '../counter';   // connectWorker client — safe to import under SSR

export function Counter() {
  const count = useSharedValue(counterMemory, 'count');
  const increment = useTask(counter.increment);  // client method → latest-wins task

  return (
    <button onClick={() => increment.run(1)}>
      count: {count ?? '…'}
    </button>
  );
}`,
    notes: [
      '\'use client\' is required on any component calling the hooks; app/page.tsx can stay a server component that just renders it.',
      'The connectWorker client is SSR-safe to import — its pool spawns lazily on the first method call, never during a server render.',
      'COOP/COEP in next.config.ts headers() is only needed when the pool uses sharedMemory; a message-only pool needs neither headers nor SharedArrayBuffer.',
    ],
  },
];
