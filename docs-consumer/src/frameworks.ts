export interface FrameworkExample {
  title: string;
  /** One-line context rendered above the block. */
  desc?: string;
  code: string;
  file?: string;
  /** Defaults to the framework's usageLanguage. */
  language?: string;
}

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
  /** Extra patterns/use cases beyond the minimal usage snippet. */
  examples: FrameworkExample[];
  /** Escape hatches past the binding layer — pool tuning, abort/timeout, lifecycle. */
  advanced?: FrameworkExample[];
  /** One-line binding note rendered above the usage block in the quickstart. */
  quickstartNote?: string;
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
    examples: [
      {
        title: 'A data-layer hook',
        desc: 'The incidents demo\'s pattern — compose the bindings once, return plain values. seed.runOnce() ignores repeat triggers while pending/settled; the page query re-runs latest-wins whenever the spec changes.',
        file: 'useIncidents.ts',
        code: `export function useIncidents(query: QueryArgs) {
  const seed = useTask(initIncidents);             // one-shot bootstrap
  const page = useTask(incidents.queryIncidents);  // latest-wins query
  const seedProgress = useSharedValue(incidentsMemory, 'signals.seedProgress');
  const metrics = useSharedValue(incidentsMemory, 'state.metrics');

  useEffect(() => seed.runOnce(), []);
  useEffect(() => {
    if (seed.settled) page.run(query);
  }, [seed.settled, query]);

  return {
    ready: seed.settled,
    seedProgress: seedProgress ?? 0,
    metrics: metrics ?? null,
    page: page.data,
    roundTripMs: page.elapsedMs,
    isFetching: page.pending,
  };
}`,
      },
      {
        title: 'Slice a field — render less often',
        desc: 'useSharedValue re-renders on every write; a selector + equals limits that to the slice you actually render.',
        code: `import { shallowEqual } from '@atolljs/core';

// Re-renders only when the {open, critical} pair changes — the other six
// metrics fields can churn without touching this component.
const pressure = useSharedValue(
  incidentsMemory,
  'state.metrics',
  (m) => ({ open: m.open, critical: m.critical }),
  { equals: shallowEqual },
);`,
      },
      {
        title: 'Task state in the UI',
        desc: 'run/runOnce trigger; the snapshot fields — pending, settled, error, elapsedMs — drive the view.',
        code: `const refresh = useTask(incidents.queryIncidents);

return (
  <>
    <button disabled={refresh.pending} onClick={() => refresh.run(query)}>
      {refresh.pending ? 'scanning…' : 'refresh'}
    </button>
    {refresh.error ? <p role="alert">{String(refresh.error)}</p> : null}
    {refresh.settled && (
      <small>round-trip {refresh.elapsedMs?.toFixed(0)}ms</small>
    )}
  </>
);`,
      },
    ],
    advanced: [
      {
        title: 'Tuning the pool',
        desc: 'connectWorker folds the WorkerPool config into the client declaration — size, queueing, timeouts, crash respawn.',
        file: 'incidents.ts',
        language: 'ts',
        code: `export const incidents = connectWorker<IncidentsWorker>({
  sharedMemory: incidentsMemory,
  worker: () => new Worker(
    new URL('./incidents.worker.ts', import.meta.url),
    { type: 'module' },
  ),
  poolSize: 'auto',    // navigator.hardwareConcurrency
  concurrency: 1,      // in-flight tasks per worker; excess queue FIFO
  maxQueue: 1_000,     // a full queue rejects with PoolQueueFullError
  respawn: true,       // replace crashed workers (default)
  taskTimeout: 5_000,  // default per-call budget — with({timeout}) overrides
  // lazy: false,      // spawn immediately instead of on first call
});`,
      },
      {
        title: 'Abort & timeout per call',
        desc: 'with() returns the same client surface with RunOptions attached. A queued call drops outright; an in-flight call is orphaned — the worker finishes it and the reply is discarded.',
        code: `import { TaskAbortedError, TaskTimeoutError } from '@atolljs/core';

const ac = new AbortController();
const request = incidents
  .with({ signal: ac.signal, timeout: 2_000 })
  .queryIncidents(query);

ac.abort();   // rejects with TaskAbortedError
try {
  await request;
} catch (e) {
  if (e instanceof TaskTimeoutError) { /* budget exceeded */ }
}`,
      },
      {
        title: 'One observable, many components',
        desc: 'Each useSharedValue call builds a fresh observe(). Hoist it to module scope and bind via useObservable — every subscriber shares one field watch, which stops when the last unsubscribes.',
        file: 'metrics.ts',
        language: 'ts',
        code: `import { observe, shallowEqual } from '@atolljs/core';
import { useObservable } from '@atolljs/react';
import { incidentsMemory } from '@atolljs/incidents';

export const pressure = observe(
  incidentsMemory,
  'state.metrics',
  (m) => ({ open: m.open, critical: m.critical }),
  { equals: shallowEqual },
);

// In any component: useObservable(pressure) — no new watch per mount.`,
      },
      {
        title: 'Lifecycle & pool stats',
        desc: 'terminate() kills the pool — the next method call re-spawns it lazily. pool.stats() exposes queue/dispatch aggregates for telemetry.',
        code: `import { useEffect } from 'react';

// A feature panel that only keeps its pool while open:
useEffect(() => () => incidents.terminate(), []);

const stats = incidents.pool?.stats();
// { workers, idle, inFlight, queued, completed, failed, aborted,
//   waitMs: { count, mean, max }, runMs: { count, mean, max } }`,
      },
    ],
    quickstartNote:
      'Hooks subscribe via useSyncExternalStore — field reads return undefined until the contract binds on the client.',
    notes: [
      'counter.increment is typed from the worker\'s defineWorker methods — no task contract to declare.',
      'Pass a selector to useSharedValue to re-render only when a slice changes: useSharedValue(memory, \'metrics\', m => m.total, { equals: shallowEqual }).',
      'Worker-hosted React trees (islands) live in the companion package @atolljs/react-island — see the Islands page under this section.',
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
    examples: [
      {
        title: 'A composable data layer',
        desc: 'Refs in, computed views out — watch() on the seed task\'s settled flag re-runs the latest-wins page query whenever the spec changes.',
        file: 'useIncidents.ts',
        language: 'ts',
        code: `export function useIncidents(query: Ref<QueryArgs>) {
  const seed = useTask(initIncidents);
  const page = useTask(incidents.queryIncidents);
  const seedProgress = useSharedValue(incidentsMemory, 'signals.seedProgress');
  const metrics = useSharedValue(incidentsMemory, 'state.metrics');

  seed.runOnce();
  watch([query, () => seed.state.value.settled], () => {
    if (seed.state.value.settled) page.run(query.value);
  }, { immediate: true });

  return {
    ready: computed(() => seed.state.value.settled),
    seedProgress: computed(() => seedProgress.value ?? 0),
    metrics: computed(() => metrics.value ?? null),
    page: computed(() => page.state.value.data),
  };
}`,
      },
      {
        title: 'Slice a field into a Ref',
        desc: 'select + equals — the Ref only emits when the slice changes.',
        language: 'ts',
        code: `import { shallowEqual } from '@atolljs/core';

const pressure = useSharedValue(
  incidentsMemory,
  'state.metrics',
  (m) => ({ open: m.open, critical: m.critical }),
  { equals: shallowEqual },
);`,
      },
      {
        title: 'React to a task settling',
        desc: 'state is a Ref<TaskSnapshot> — watch its fields for follow-up work.',
        language: 'ts',
        code: `const page = useTask(incidents.queryIncidents);

watch(() => page.state.value.settled, (ok) => {
  if (ok) console.log('rows:', page.state.value.data?.rows.length);
});`,
      },
    ],
    advanced: [
      {
        title: 'One observable, many components',
        desc: 'Each useSharedValue builds its own observe(). Hoist it to module scope and wrap with useObservable — all subscribers share one field watch; onScopeDispose still unsubscribes per scope.',
        file: 'metrics.ts',
        language: 'ts',
        code: `import { observe, shallowEqual } from '@atolljs/core';
import { useObservable } from '@atolljs/vue';
import { incidentsMemory } from '@atolljs/incidents';

export const pressure = observe(
  incidentsMemory,
  'state.metrics',
  (m) => ({ open: m.open, critical: m.critical }),
  { equals: shallowEqual },
);

// in <script setup>: const p = useObservable(pressure); // shared watch`,
      },
      {
        title: 'Imperative watch — outside components',
        desc: 'watch() on a field connector fires on every write, local or remote — for logging, analytics, or bridging to non-reactive code. Dispose the returned function yourself.',
        language: 'ts',
        code: `import { watch } from '@atolljs/core';
import { incidentsMemory } from '@atolljs/incidents';

const stop = watch(
  incidentsMemory.connector('state.metrics'),
  (m) => console.log('open incidents:', m?.open),
);

stop();   // when the feature unloads`,
      },
      {
        title: 'Abort & timeout per call',
        desc: 'with() attaches RunOptions to the same client surface. A queued call drops outright; an in-flight call is orphaned — the worker finishes it and the reply is discarded.',
        language: 'ts',
        code: `import { TaskAbortedError, TaskTimeoutError } from '@atolljs/core';

const ac = new AbortController();
const request = incidents
  .with({ signal: ac.signal, timeout: 2_000 })
  .queryIncidents(query);

ac.abort();   // rejects with TaskAbortedError`,
      },
      {
        title: 'Pool lifecycle under HMR',
        desc: 'terminate() kills the pool — the next method call re-spawns it lazily. Without a dispose hook, Vite hot reloads would leak workers.',
        language: 'ts',
        code: `if (import.meta.hot) {
  import.meta.hot.dispose(() => incidents.terminate());
}

incidents.pool?.stats();   // { workers, idle, inFlight, queued, … }`,
      },
    ],
    quickstartNote:
      'The composables return Refs — subscriptions release via onScopeDispose when the component unmounts.',
    notes: [
      'watch() the task\'s settled Ref to trigger follow-up work after a run.',
      'Worker-hosted Vue trees (islands) live in the companion package @atolljs/vue-island — see the Islands page under this section.',
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
    examples: [
      {
        title: 'A reactive data layer',
        desc: 'createEffect tracks both the query accessor and the seed task\'s settled flag — the page query re-runs latest-wins on any change after seeding.',
        file: 'incidents.ts',
        language: 'ts',
        code: `export function createIncidents(query: Accessor<QueryArgs>) {
  const seed = createTask(initIncidents);
  const page = createTask(incidents.queryIncidents);
  const seedProgress = createSharedValue(incidentsMemory, 'signals.seedProgress');
  const metrics = createSharedValue(incidentsMemory, 'state.metrics');

  seed.runOnce();
  createEffect(() => {
    const q = query();
    if (seed.state().settled) page.run(q);
  });

  return {
    ready: () => seed.state().settled,
    seedProgress: () => seedProgress() ?? 0,
    metrics: () => metrics() ?? null,
    page: () => page.state().data,
    isFetching: () => page.state().pending,
  };
}`,
      },
      {
        title: 'Gate the UI on task state',
        desc: 'state() is an Accessor<TaskSnapshot> — Show/Switch track pending natively, no isPending flag to manage.',
        code: `const page = createTask(incidents.queryIncidents);

return (
  <Show when={!page.state().pending} fallback={<p>scanning 1M records…</p>}>
    <table>{/* page.state().data?.rows */}</table>
  </Show>
);`,
      },
      {
        title: 'Slice a field into an Accessor',
        desc: 'select + equals — the Accessor only emits when the slice changes.',
        language: 'ts',
        code: `import { shallowEqual } from '@atolljs/core';

const pressure = createSharedValue(
  incidentsMemory,
  'state.metrics',
  (m) => ({ open: m.open, critical: m.critical }),
  { equals: shallowEqual },
);`,
      },
    ],
    advanced: [
      {
        title: 'One observable, many components',
        desc: 'Each createSharedValue builds its own observe(). Hoist it to module scope and wrap with createObservable — all subscribers share one field watch; onCleanup still disposes per owner.',
        file: 'metrics.ts',
        language: 'ts',
        code: `import { observe, shallowEqual } from '@atolljs/core';
import { createObservable } from '@atolljs/solidjs';
import { incidentsMemory } from '@atolljs/incidents';

export const pressure = observe(
  incidentsMemory,
  'state.metrics',
  (m) => ({ open: m.open, critical: m.critical }),
  { equals: shallowEqual },
);

// in a component: const p = createObservable(pressure); // shared watch`,
      },
      {
        title: 'Write back to shared memory',
        desc: 'reactive() wraps a connector as a signal-tracked view whose set() writes through to the buffer — the worker reads it on its side. observeRemote() tracks writes coming back.',
        language: 'ts',
        code: `import { reactive } from '@atolljs/core';
import { incidentsMemory } from '@atolljs/incidents';

const seedProgress = reactive(
  incidentsMemory.connector('signals.seedProgress'),
);
const stopRemote = seedProgress.observeRemote();  // worker → main
seedProgress.set(0);                              // main → worker`,
      },
      {
        title: 'Abort & timeout per call',
        desc: 'with() attaches RunOptions to the same client surface. A queued call drops outright; an in-flight call is orphaned — the worker finishes it and the reply is discarded.',
        language: 'ts',
        code: `import { TaskAbortedError, TaskTimeoutError } from '@atolljs/core';

const ac = new AbortController();
const request = incidents
  .with({ signal: ac.signal, timeout: 2_000 })
  .queryIncidents(query);

ac.abort();   // rejects with TaskAbortedError`,
      },
      {
        title: 'Pool lifecycle & stats',
        desc: 'terminate() kills the pool — the next method call re-spawns it lazily. pool.stats() exposes queue/dispatch aggregates.',
        language: 'ts',
        code: `import { onCleanup } from 'solid-js';

onCleanup(() => incidents.terminate());   // owner teardown → pool down

incidents.pool?.stats();   // { workers, idle, inFlight, queued, … }`,
      },
    ],
    quickstartNote:
      'The create* factories return Accessors — subscriptions dispose with the owner via onCleanup.',
    notes: [
      'Subscriptions auto-dispose via onCleanup when the owner is destroyed.',
      'Worker-hosted Solid trees (islands) live in the companion package @atolljs/solid-island — see the Islands page under this section.',
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
    examples: [
      {
        title: 'A .svelte.ts data layer',
        desc: 'Factories run during component init (or in a .svelte.ts module) so runes compile — the returned object exposes plain getters that stay reactive in the template.',
        file: 'incidents.svelte.ts',
        language: 'ts',
        code: `export function createIncidents(getQuery: () => QueryArgs) {
  const seed = taskState(initIncidents);
  const pageTask = taskState(incidents.queryIncidents);
  const seedProgress = sharedValue(incidentsMemory, 'signals.seedProgress');
  const metrics = sharedValue(incidentsMemory, 'state.metrics');

  seed.runOnce();
  $effect(() => {
    const q = getQuery();
    if (seed.settled) pageTask.run(q);
  });

  return {
    get ready() { return seed.settled; },
    get seedProgress() { return seedProgress.value ?? 0; },
    get metrics() { return metrics.value ?? null; },
    get page() { return pageTask.data; },
    get isFetching() { return pageTask.pending; },
  };
}`,
      },
      {
        title: 'Drive the template',
        desc: 'The getters read rune-backed state — conditionals and progress bars update on every worker write.',
        code: `<script lang="ts">
  import { createIncidents } from './incidents.svelte';
  const data = createIncidents(() => query);
</script>

{#if !data.ready}
  <progress value={data.seedProgress} max={1} />
{:else if data.isFetching}
  <p>scanning…</p>
{:else}
  <p>{data.page?.rows.length ?? 0} rows</p>
{/if}`,
      },
    ],
    advanced: [
      {
        title: 'One observable, many components',
        desc: 'Each sharedValue builds its own observe(). Hoist it to module scope and wrap with observableValue — subscribers share one field watch; each still tears down with its owning effect.',
        file: 'metrics.svelte.ts',
        language: 'ts',
        code: `import { observe, shallowEqual } from '@atolljs/core';
import { observableValue } from '@atolljs/svelte';
import { incidentsMemory } from '@atolljs/incidents';

const pressureSource = observe(
  incidentsMemory,
  'state.metrics',
  (m) => ({ open: m.open, critical: m.critical }),
  { equals: shallowEqual },
);

export const pressure = () => observableValue(pressureSource);`,
      },
      {
        title: 'Abort & timeout per call',
        desc: 'with() attaches RunOptions to the same client surface. A queued call drops outright; an in-flight call is orphaned — the worker finishes it and the reply is discarded.',
        language: 'ts',
        code: `import { TaskAbortedError, TaskTimeoutError } from '@atolljs/core';

const ac = new AbortController();
const request = incidents
  .with({ signal: ac.signal, timeout: 2_000 })
  .queryIncidents(query);

ac.abort();   // rejects with TaskAbortedError`,
      },
      {
        title: 'Imperative watch — outside components',
        desc: 'watch() on a field connector fires on every write, local or remote — for logging or bridging to non-rune code. Dispose the returned function yourself.',
        language: 'ts',
        code: `import { watch } from '@atolljs/core';
import { incidentsMemory } from '@atolljs/incidents';

const stop = watch(
  incidentsMemory.connector('state.metrics'),
  (m) => console.log('open incidents:', m?.open),
);

stop();   // when the feature unloads`,
      },
      {
        title: 'Pool lifecycle & stats',
        desc: 'terminate() kills the pool — the next method call re-spawns it lazily. pool.stats() exposes queue/dispatch aggregates.',
        language: 'ts',
        code: `// $effect cleanup / onDestroy — wherever the feature tears down:
incidents.terminate();

incidents.pool?.stats();   // { workers, idle, inFlight, queued, … }`,
      },
    ],
    quickstartNote:
      'Call the factories during component init — they are rune-backed; teardown happens in an $effect cleanup.',
    notes: [
      'Factories must run in a .svelte.ts module or during component init so runes compile correctly.',
      'Worker-hosted Svelte trees (islands) live in the companion package @atolljs/svelte-island — see the Islands page under this section.',
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
    examples: [
      {
        title: 'Component wiring — DI client + signals',
        desc: 'injectAtollPool returns the provideAtoll-registered client; taskState/sharedValue release their subscriptions on destroy. effect() re-runs the latest-wins query once seeded.',
        file: 'app.component.ts',
        code: `private readonly incidents = injectAtollPool<IncidentsClient>('incidents');

private readonly seedTask = taskState(initIncidents);
private readonly pageTask = taskState(this.incidents.queryIncidents);
private readonly metricsValue = sharedValue(incidentsMemory, 'state.metrics');

protected readonly metrics = computed(() => this.metricsValue() ?? null);
protected readonly isFetching = computed(() => this.pageTask.state().pending);

constructor() {
  this.seedTask.runOnce();   // ignores repeats while pending/settled
  effect(() => {
    const q = this.query();
    if (this.seedTask.state().settled) this.pageTask.run(q);
  });
}`,
      },
      {
        title: 'NgModule apps — AtollModule',
        desc: 'The NgModule equivalent of provideAtoll — same pool declarations and lifecycle, plus constructor-parameter injection via @InjectAtollPool.',
        file: 'app.module.ts',
        code: `@NgModule({
  imports: [
    AtollModule.forRoot({
      pools: [{ name: 'incidents', client: incidents }],
    }),
  ],
})
export class AppModule {}

@Injectable()
export class ReportsService {
  constructor(
    @InjectAtollPool('incidents') private readonly pool: WorkerPool,
  ) {}
}`,
      },
      {
        title: 'Inline worker pools',
        desc: 'Declarations can build the pool directly — the bundler-detectable new Worker(new URL(...)) stays inline so the worker entry is emitted as its own chunk.',
        file: 'main.ts',
        code: `provideAtoll({
  pools: [{
    name: 'digest',
    worker: () => new Worker(
      new URL('./digest.worker.ts', import.meta.url),
      { type: 'module' },
    ),
    sharedMemory: digestMemory,
    poolSize: 2,
    tasks: { hash: HashDigest },
  }],
})`,
      },
    ],
    advanced: [
      {
        title: 'Route-scoped pools',
        desc: 'provideAtoll works in Route.providers — the pool spawns when the route injector is created and terminates when it is destroyed. Lazy features get lazy pools.',
        file: 'app.routes.ts',
        language: 'ts',
        code: `const routes: Routes = [{
  path: 'reports',
  providers: [
    provideAtoll({ pools: [{ name: 'incidents', client: incidents }] }),
  ],
  loadComponent: () => import('./reports.component'),
}];`,
      },
      {
        title: 'Async pool declarations',
        desc: 'registerPoolAsync/forRootAsync resolve the spec from injected deps during APP_INITIALIZER — name stays static so the ATOLL_POOL:<name> token is injectable throughout.',
        file: 'app.module.ts',
        language: 'ts',
        code: `AtollModule.registerPoolAsync({
  name: 'incidents',
  inject: [PoolConfig],
  useFactory: (config: PoolConfig) => ({
    worker: () => new Worker(
      new URL('./incidents.worker.ts', import.meta.url)),
    sharedMemory: incidentsMemory,
    poolSize: config.poolSize,
  }),
})`,
      },
      {
        title: 'Testing — stub the pool token',
        desc: 'Each pool is a plain InjectionToken (ATOLL_POOL:<name>) — override it in TestBed with a stub; the component never touches a real worker.',
        language: 'ts',
        code: `await TestBed.configureTestingModule({
  providers: [
    { provide: getAtollPoolToken('incidents'), useValue: stubIncidents },
  ],
}).compileComponents();`,
      },
      {
        title: 'Abort & timeout per call',
        desc: 'with() attaches RunOptions to the same client surface. A queued call drops outright; an in-flight call is orphaned — the worker finishes it and the reply is discarded.',
        language: 'ts',
        code: `import { TaskAbortedError, TaskTimeoutError } from '@atolljs/core';

const ac = new AbortController();
const request = this.incidents
  .with({ signal: ac.signal, timeout: 2_000 })
  .queryIncidents(query);

ac.abort();   // rejects with TaskAbortedError`,
      },
    ],
    quickstartNote:
      'provideAtoll registers the client as a DI provider (terminated on app teardown); the signal factories must run in an injection context.',
    notes: [
      'Works with OnPush + zoneless change detection out of the box.',
      'Worker-hosted Angular trees (islands) live in the companion package @atolljs/angular-island — see the Islands page under this section.',
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
    examples: [
      {
        title: 'A data-layer hook',
        desc: 'The same incidents pattern as the React demo — the hook is a client-boundary module; seed.runOnce() ignores repeats while pending/settled and the page query re-runs latest-wins on spec change.',
        file: 'src/useIncidents.ts',
        code: `'use client';

export function useIncidents(query: QueryArgs) {
  const seed = useTask(initIncidents);             // one-shot bootstrap
  const page = useTask(incidents.queryIncidents);  // latest-wins query
  const seedProgress = useSharedValue(incidentsMemory, 'signals.seedProgress');
  const metrics = useSharedValue(incidentsMemory, 'state.metrics');

  useEffect(() => seed.runOnce(), []);
  useEffect(() => {
    if (seed.settled) page.run(query);
  }, [seed.settled, query]);

  return {
    ready: seed.settled,
    seedProgress: seedProgress ?? 0,
    metrics: metrics ?? null,
    page: page.data,
    isFetching: page.pending,
  };
}`,
      },
      {
        title: 'Live fields in any client component',
        desc: 'Any number of client components can bind the same shared field — each subscribes independently and tracks the worker\'s writes.',
        file: 'components/SeedProgress.tsx',
        code: `'use client';

import { useSharedValue } from '@atolljs/nextjs';
import { incidentsMemory } from '@atolljs/incidents';

export function SeedProgress() {
  const progress = useSharedValue(incidentsMemory, 'signals.seedProgress');
  return <progress value={progress ?? 0} max={1} />;
}`,
      },
    ],
    advanced: [
      {
        title: 'SSR: fields read undefined on the server',
        desc: 'The contract only binds in the browser — render fallbacks and let hydration fill in. Trigger run()/runOnce() from event handlers or effects, never during render.',
        file: 'components/Counter.tsx',
        code: `'use client';

const count = useSharedValue(counterMemory, 'count');
// Server render: undefined → '…'. Client: binds, then streams writes.
return <span>{count ?? '…'}</span>;`,
      },
      {
        title: 'Abort & timeout per call',
        desc: 'with() attaches RunOptions to the same client surface. A queued call drops outright; an in-flight call is orphaned — the worker finishes it and the reply is discarded.',
        language: 'ts',
        code: `import { TaskAbortedError, TaskTimeoutError } from '@atolljs/core';

const ac = new AbortController();
const request = incidents
  .with({ signal: ac.signal, timeout: 2_000 })
  .queryIncidents(query);

ac.abort();   // rejects with TaskAbortedError`,
      },
      {
        title: 'One observable, many components',
        desc: 'Each useSharedValue call builds a fresh observe(). Hoist it to module scope and bind via useObservable — subscribers share one field watch.',
        file: 'metrics.ts',
        language: 'ts',
        code: `import { observe, shallowEqual } from '@atolljs/core';
import { useObservable } from '@atolljs/nextjs';
import { incidentsMemory } from '@atolljs/incidents';

export const pressure = observe(
  incidentsMemory,
  'state.metrics',
  (m) => ({ open: m.open, critical: m.critical }),
  { equals: shallowEqual },
);`,
      },
      {
        title: 'Worker entries under webpack/turbopack',
        desc: 'Both bundlers emit a worker chunk only when new Worker(new URL(\'./x.worker.ts\', import.meta.url)) appears inline — never hoist or compute the URL. Contracts imported from workspace sources need resolve aliases + experimental.externalDir (see examples/nextjs/next.config.ts).',
        file: 'next.config.ts',
        language: 'ts',
        code: `experimental: { externalDir: true },
turbopack: {
  root: '../../',
  resolveAlias: {
    '@atolljs/core': '../../src/index.ts',
    '@atolljs/nextjs': '../../packages/nextjs/src/index.ts',
    // …
  },
},`,
      },
    ],
    quickstartNote:
      'The \'use client\' directive is required on components calling the hooks; the connectWorker client is safe to import under SSR — the pool spawns lazily on the first call.',
    notes: [
      '\'use client\' is required on any component calling the hooks; app/page.tsx can stay a server component that just renders it.',
      'The connectWorker client is SSR-safe to import — its pool spawns lazily on the first method call, never during a server render.',
      'COOP/COEP in next.config.ts headers() is only needed when the pool uses sharedMemory; a message-only pool needs neither headers nor SharedArrayBuffer.',
    ],
  },
];
