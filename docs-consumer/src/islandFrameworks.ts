import svelteCounter from '../../packages/svelte-island/test/fixtures/Counter.svelte?raw';

export interface IslandFramework {
  id: string;
  name: string;
  pkg: string;
  intro: string;
  componentCode?: string;
  componentCodeFile?: string;
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
    componentCodeFile: 'Counter.vue (worker component)',
    componentCode: `<script setup lang="ts">
// Ordinary Vue SFC — compiled for the worker bundle, mounted in the proxy
// document. No DOM access; props must be serializable; emit() is the
// island → shell channel.
import { ref } from 'vue';
import { emit } from '@atolljs/vue-island/worker';

const props = withDefaults(defineProps<{ start?: number }>(), { start: 0 });
const count = ref(props.start);
</script>

<template>
  <div class="card">
    <button @click="count++; emit('incremented', { count })">
      count: {{ count }}
    </button>
  </div>
</template>`,
    workerCodeFile: 'vue.worker.ts (worker entry)',
    workerCode: `import { defineVuePolyWorker, vueIslandApp } from '@atolljs/vue-island/worker';
import { installDomShim } from '@atolljs/islands/worker';
import Counter from './Counter.vue';  // SFC — needs @vitejs/plugin-vue in the worker build

export const vueWorker = defineVuePolyWorker({
  apps: { counter: Counter },
});

// Or an imperative proxy-DOM app alongside — no Vue involved:
vueIslandApp('hello', {
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
    // The real fixture the svelte-island suite runs — props are wire-driven,
    // $state mutates through delegated handlers, emit() reaches the shell.
    componentCodeFile: 'packages/svelte-island/test/fixtures/Counter.svelte',
    componentCode: svelteCounter,
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
    componentCodeFile: 'Counter.tsx (worker component)',
    componentCode: `import { createSignal } from 'solid-js';
import { emit } from '@atolljs/islands/worker';

// Ordinary Solid JSX — compiled for solid-js/universal, so each signal
// write produces a minimal op batch. Serializable props; emit() talks
// back to the shell.
export function Counter(props: { start?: number }) {
  const [count, setCount] = createSignal(props.start ?? 0);
  return (
    <div class="card">
      <button onClick={() => { const n = count() + 1; setCount(n); emit('incremented', { count: n }); }}>
        count: {count()}
      </button>
    </div>
  );
}`,
    workerCodeFile: 'solid.worker.ts (worker entry)',
    workerCode: `import { defineSolidPolyWorker } from '@atolljs/solid-island/worker';
import { Counter } from './Counter';

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
      'islandComponent<P>(\'name\') / lazyIsland(loader) proxy a worker app as a local-typed component — inline props, Suspense code-splitting, { app, worker } contract modules.',
    ],
  },
  angular: {
    id: 'angular',
    name: 'Angular islands',
    pkg: '@atolljs/angular-island',
    intro:
      'Angular\'s official Renderer2/RendererFactory2 extension point, implemented against the proxy DOM — worker components bootstrap through createComponent with a custom renderer. Zoneless change detection keeps the tree updated; shell side is a generated islandComponent facade typed off the worker component\'s own signal fields. Works with JIT or AOT-compiled components.',
    componentCodeFile: 'counter.component.ts (worker component)',
    componentCode: `import { Component, input, output, signal } from '@angular/core';
import { AngularIsland } from '@atolljs/angular-island/worker';

// @AngularIsland stamps the registry name ('counter' from the class name)
// and registers the component for defineAngularPolyWorker(). Its signal
// fields ARE the island contract: input()/model() → props keys,
// output()/model() → island events bridged to the shell.
@AngularIsland
@Component({
  standalone: true,
  selector: 'atoll-counter',
  template: \`
    <p class="label">{{ label() }}</p>
    <button (click)="increment()">count: {{ count() }}</button>
  \`,
})
export class CounterComponent {
  readonly label = input('counter');
  readonly count = signal(0);
  readonly incremented = output<number>();
  increment(): void {
    this.count.update((n) => n + 1);
    this.incremented.emit(this.count());
  }
}`,
    workerCodeFile: 'angular.worker.ts (worker entry)',
    workerCode: `import '@angular/compiler';  // JIT only — AOT-compiled components skip this
import { defineAngularPolyWorker } from '@atolljs/angular-island/worker';
import './counter.component'; // registers via @AngularIsland

// No apps map — every decorated component in the module graph is served.
export const angularWorker = defineAngularPolyWorker();`,
    shellCodeFile: 'Angular shell',
    shellCode: `import { Component } from '@angular/core';
import { islandComponent, type IslandEventHandler } from '@atolljs/angular-island';
import type { CounterComponent } from './counter.component'; // type-only!

// A real standalone component — [props] types as { label?: string },
// onEvent narrows to ('incremented', number). The worker module itself
// never enters this bundle.
const CounterIsland = islandComponent<CounterComponent>({
  app: 'counter',
  worker: () => new Worker(
    new URL('./angular.worker.ts', import.meta.url), { type: 'module' }),
  selector: 'counter-island',
});

@Component({
  standalone: true,
  imports: [CounterIsland],
  template: \`
    <counter-island [props]="{ label: 'alpha' }" [onEvent]="onEvent" />
  \`,
})
export class AppComponent {
  onEvent: IslandEventHandler<CounterComponent> = (name, payload) => {
    if (name === 'incremented') console.log(payload); // payload: number
  };
}`,
    notes: [
      '@AngularIsland also takes an explicit name or { name, providers } — and undecorated components register via the apps array/record forms of defineAngularPolyWorker.',
      'Root output()/model() fields bridge onto the emit channel under their public names (x = model() → \'xChange\') — the adapter handles island-instance re-entry, so afterEveryRender-style emits just work.',
      'JIT components need import \'@angular/compiler\' once in the worker entry — the JIT decorators compile at bootstrap. AOT-compiled components skip it; the generated facade carries a hand-authored ɵcmp so it resolves under both.',
      'The low-level surface stays available: <atoll-island>/<div atollIsland> with [client] (shared) or [worker] (island-owned), [app] accepting a registry name or the stamped component class.',
      'The worker renderer is a Renderer2 — @DomSanitizer flows through as passthrough; anything Angular sanitizes is already declared safe in a worker.',
      'Forms and animations are untested/explored territory — (click)/(input) bindings work; TemplateRef renders into the proxy tree.',
      'defineAngularMonoWorker(component) for the 1:1 topology.',
    ],
  },
};
