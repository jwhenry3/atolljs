export interface IslandFramework {
  id: string;
  name: string;
  pkg: string;
  intro: string;
  workerCode?: string;
  workerCodeFile?: string;
  shellCode?: string;
  shellCodeFile?: string;
  notes: string[];
}

export const ISLAND_FRAMEWORKS: Record<string, IslandFramework> = {
  vue: {
    id: 'vue',
    name: 'Vue islands',
    pkg: '@atolljs/vue-island',
    intro:
      'A Vue 3 renderer running in the worker — a real RuntimeRenderer backed by the proxy DOM, with v-model emit equivalence, Teleport, transition stubs, and Vue\'s own scheduler (microtask queue + post queue). Shell side: a <AtollIsland> component or a useIsland() composable.',
    workerCodeFile: 'vue.worker.ts (worker entry)',
    workerCode: `import { createApp, defineComponent, h, ref } from 'vue';
import {
  defineVuePolyWorker,
  vueIslandApp,
} from '@atolljs/vue-island/worker';
import { bumpOpsVersion, installDomShim, runInInstance } from '@atolljs/islands/worker';

// Composition or Options API — anything runtime-only Vue compiles.
const CounterApp = defineComponent({
  props: { start: { type: Number, default: 0 } },
  setup(props) {
    const count = ref(props.start);
    return () =>
      h('div', { class: 'card' }, [
        h('button', { onClick: () => count.value++ }, 'increment'),
        h('span', 'count: ' + count.value),
      ]);
  },
});

export const vueWorker = defineVuePolyWorker({
  apps: { counter: CounterApp },
});

// Or an imperative proxy-DOM app alongside — the .value Map() call
// registers every keyed DOM node it builds for getElementById:
const hello = vueIslandApp('hello', {
  imperative: (doc) => {
    installDomShim(doc);
    const btn = doc.createElement('button');
    btn.addEventListener('click', () => { btn.textContent = 'clicked'; });
    doc.body.appendChild(btn);
    return () => btn.remove();
  },
});`,
    shellCodeFile: 'Vue shell',
    shellCode: `<script setup lang="ts">
import { AtollIsland } from '@atolljs/vue-island';
import type { vueWorker } from './vue.worker';
import { onRef } from './shared-worker'; // the shared island client pattern

const worker = () =>
  new Worker(new URL('./vue.worker.ts', import.meta.url), { type: 'module' });
</script>

<template>
  <AtollIsland :worker="worker" app="counter" :props="{ start: 10 }"
              @island-event="onIslandsEvent" />
  <!-- or the composable: useIsland(elRef, { client, app, props }) -->
</template>`,
    notes: [
      'v-model works end-to-end — form payloads stamp .value/.checked on the synthetic target before the handler runs.',
      'Teleport resolves "body"/selector targets to the instance doc; transition/transition-group render children with lifecycle hooks stubbed.',
      'The Vue scheduler is preserved — flush-order semantics match main-thread Vue.',
      'defineVueMonoWorker(app) for a dedicated worker; defineVuePolyWorker({ apps }) for a registry.',
    ],
  },
  svelte: {
    id: 'svelte',
    name: 'Svelte islands',
    pkg: '@atolljs/svelte-island',
    intro:
      'Svelte 5 components mounting inside the worker through real mount()/unmount() against a proxy-DOM target — rune-compiled components only. Shell side: an island action or createIslandState() for rune-friendly wiring.',
    workerCodeFile: 'svelte.worker.ts (worker entry)',
    workerCode: `import { defineSveltePolyWorker } from '@atolljs/svelte-island/worker';
import Counter from './Counter.svelte';  // rune-compiled Svelte 5 component

export const svelteWorker = defineSveltePolyWorker({
  apps: { counter: Counter },
});`,
    shellCodeFile: 'Svelte shell',
    shellCode: `<script lang="ts">
  import { island } from '@atolljs/svelte-island';

  const worker = () =>
    new Worker(new URL('./svelte.worker.ts', import.meta.url), { type: 'module' });
</script>

<div use:island={{ worker, app: 'counter', props: { start: 0 } }} />
<!-- or createIslandState(options) in rune mode for reactive props/events -->`,
    notes: [
      'Components must be rune-compiled (compilerOptions.runes) — the worker renderer mounts the Svelte 5 component shape.',
      'The worker-side wrapper resolves each app through real mount()/unmount(); flushSync() boundaries emit ops.',
      'defineSvelteMonoWorker(app) / defineSveltePolyWorker({ apps }) mirror the shared/mono topology split.',
    ],
  },
  solid: {
    id: 'solid',
    name: 'Solid islands',
    pkg: '@atolljs/solid-island',
    intro:
      'Solid JSX rendering through the official solid-js/universal renderer — the same API surface frameworks like Three.js renderers use — so the worker keeps Solid\'s fine-grained reactivity: each signal update produces a minimal op batch. Shell side: a <Island> component or a createIsland() primitive.',
    workerCodeFile: 'solid.worker.ts (worker entry)',
    workerCode: `import { createSignal } from 'solid-js';
import { defineSolidPolyWorker } from '@atolljs/solid-island/worker';

function Counter(props: { start: number }) {
  const [count, setCount] = createSignal(props.start);
  return (
    <div class="card">
      <button onClick={() => setCount(count() + 1)}>increment</button>
      <span>count: {count()}</span>
    </div>
  );
}

export const solidWorker = defineSolidPolyWorker({
  apps: { counter: Counter },
});`,
    shellCodeFile: 'Solid shell',
    shellCode: `import { Island } from '@atolljs/solid-island';

const worker = () =>
  new Worker(new URL('./solid.worker.ts', import.meta.url), { type: 'module' });

<Island worker={worker} app="counter" props={{ start: 0 }} />
// or createIsland(el, options) — returns { props, events } signals` ,
    notes: [
      'Fine-grained updates — signal writes map to minimal op batches; Solid is the highest-updates-per-commit workload of the four.',
      'Configure your bundler to compile worker JSX for the universal renderer (solid-js/universal), not dom-expressions.',
      'Worker props arrive as getters — Solid props are signal-shaped; updates re-run derivations fine-grained.',
      'defineSolidMonoWorker(app) / defineSolidPolyWorker({ apps }) for the two topologies.',
    ],
  },
  angular: {
    id: 'angular',
    name: 'Angular islands',
    pkg: '@atolljs/angular-island',
    intro:
      'Angular\'s official Renderer2/RendererFactory2 extension point, implemented against the proxy DOM — worker components bootstrap through createApplication with a custom platform. Zoneless change detection keeps the tree updated; shell side is a <atoll-island> standalone directive. Works with JIT or AOT-compiled components.',
    workerCodeFile: 'angular.worker.ts (worker entry)',
    workerCode: `import { Component } from '@angular/core';
import { defineAngularPolyWorker } from '@atolljs/angular-island/worker';

@Component({
  standalone: true,
  selector: 'atoll-counter',
  template: \`<button (click)="count = count + 1">count: {{ count }}</button>\`,
})
class CounterComponent { count = 0; }

export const angularWorker = defineAngularPolyWorker({
  apps: { counter: CounterComponent },
});`,
    shellCodeFile: 'Angular shell',
    shellCode: `import { Component } from '@angular/core';
import { AtollIsland } from '@atolljs/angular-island';

@Component({
  standalone: true,
  imports: [AtollIsland],
  template: \`
    <div atollIsland
         [worker]="worker"
         app="counter"
         [props]="{ start: 0 }"
         (islandEvent)="onIslandEvent($event)"></div>
  \`,
})
export class AppComponent {
  worker = () =>
    new Worker(new URL('./angular.worker.ts', import.meta.url), { type: 'module' });
}`,
    notes: [
      'JIT components need import \'@angular/compiler\' once in the worker entry — the JIT decorators compile at bootstrap. AOT-compiled components skip it.',
      'The worker renderer is a Renderer2 — @DomSanitizer flows through as passthrough; anything Angular sanitizes is already declared safe in a worker.',
      'Forms and animations are untested/explored territory — (click)/(input) bindings work; TemplateRef renders into the proxy tree.',
      'defineAngularMonoWorker(component) / defineAngularPolyWorker({ apps }) for the two topologies.',
    ],
  },
};
