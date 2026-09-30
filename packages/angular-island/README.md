# @atolljs/angular-island

The Angular shell surface for `@atolljs/islands` — mount a worker-hosted tree
as an ordinary element in a main-thread Angular app — plus the Angular
**worker renderer**: a standalone component bootstraps via `createComponent`
against a `Renderer2`/`RendererFactory2` bound to the instance's proxy
document (the same abstraction platform-server uses), so every render call
serializes to the op stream the shell replays as real DOM.

**[Atoll — package documentation](https://jwhenry3.github.io/atolljs/consumer/quickstart/)**

## Install

```bash
npm install @atolljs/core @atolljs/islands @atolljs/angular-island @angular/core @angular/common
```

## The facade: `@AngularIsland` + `islandComponent`

The Angular-native pairing — decorate the worker's top-level component, and
the class itself becomes the island's contract:

```ts
// counter.component.ts — the worker-side component
import '@angular/compiler';                     // JIT decorator components only
import { Component, input, output, signal } from '@angular/core';
import { AngularIsland, defineAngularPolyWorker } from '@atolljs/angular-island/worker';

@AngularIsland                                  // 'counter' — derived from the class name
@Component({
  standalone: true,
  selector: 'atoll-counter',
  template: `<button (click)="inc()">{{ label() }}: {{ n() }}</button>`,
})
export class CounterComponent {
  readonly label = input('count');              // → [props] key 'label'
  readonly n = signal(0);
  readonly bumped = output<number>();           // → island event 'bumped'
  inc() { this.n.update((v) => v + 1); this.bumped.emit(this.n()); }
}

export const worker = defineAngularPolyWorker(); // collects every @AngularIsland
```

```ts
// shell.component.ts — main thread
import { Component } from '@angular/core';
import { islandComponent } from '@atolljs/angular-island';
import type { CounterComponent } from './counter.component'; // type-only!

const CounterIsland = islandComponent<CounterComponent>({
  app: 'counter',
  worker: () => new Worker(new URL('./counter.worker.ts', import.meta.url), { type: 'module' }),
  selector: 'counter-island',
});

@Component({
  standalone: true,
  imports: [CounterIsland],
  // [props] is typed as { label?: string } — the component's input() fields;
  // onEvent narrows payload per event name via the output()/model() fields.
  template: `<counter-island [props]="{ label: 'alpha' }" [onEvent]="onBumped" />`,
})
export class ShellComponent {
  onBumped = (name: 'bumped', payload: number) => { ... };
}
```

- **`@AngularIsland`** (worker entry) stamps `islandAppName` and registers the
  class — `@AngularIsland`, `@AngularIsland('name')`, and
  `@AngularIsland({ name, providers })` all work. Undecorated components
  register via `defineAngularPolyWorker({ apps: [A, B] })` (array) or the
  record form `{ apps: { counter: CounterComponent } }`.
- **Root outputs bridge to `emit`** — a root component's `output()`/`model()`
  fields have no template host inside an island, so each declared output is
  forwarded onto the island's emit channel under its public name
  (`saved` → `'saved'`, `x = model()` → `'xChange'`). Re-entry into the
  island instance is handled by the adapter.
- **`islandComponent<C>`** generates a real standalone component — a
  hand-authored `ɵcmp` works under AOT *and* JIT, and `import type` keeps
  the worker module out of the shell bundle. `app`/`client`/`worker`/
  `workerOptions`/`mode` in the config are defaults; template bindings can
  still override.

## `<atoll-island>` / `[atollIsland]` — the low-level surface

```ts
import { Component } from '@angular/core';
import { AtollIslandComponent } from '@atolljs/angular-island';
import { connectIslandWorker } from '@atolljs/islands';

const renderWorker = () =>
  new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });

@Component({
  standalone: true,
  imports: [AtollIslandComponent],   // or AtollIslandModule for NgModule apps
  template: `
    <atoll-island
      [client]="client"
      app="charts"
      [props]="{ width: width }"
      [onEvent]="onIslandEvent"
      class="island-box" />
  `,
})
export class ShellComponent {
  client = connectIslandWorker({ worker: renderWorker });  // shareable across islands
  width = 640;
  onIslandEvent = (name: string, payload: unknown) => { ... };
}
```

`[atollIsland]` is the directive form for existing elements. Either `client`
(shared `connectIslandWorker` handle — several islands in one worker) or
`worker` (`() => new Worker(...)`/URL — island-owned 1:1 worker) is required;
`[workerOptions]`/`[mode]` configure the shorthand path, and `[app]` accepts
a registry name or the component class itself (its `@AngularIsland` stamp
resolves the name). Type parameters carry inference:
`AtollIslandComponent<CounterComponent>` types `props`/`onEvent` from the
class's signal fields.

## The worker renderer

`angularIslandApp` is the adapter the worker helpers wrap —
`mount` creates the component in a bare environment injector
(`providedIn: 'root'` services and `options.providers` resolve). Change
detection is zoneless — every dispatched listener and `setInput` ends in a
synchronous `detectChanges` plus the `AfterRenderManager` pass, so
`afterRenderEffect`/`effect()` run, and signal writes from timers/promise
continuations queue a microtask tick inside the instance.
`emit`/`runInInstance` are re-exported for the island→shell channel (manual
emits — e.g. from a non-output path like a subscription — still work;
root `output()`/`model()` fields are bridged automatically).

```ts
// Worker entry variants — pick one:
export const worker = defineAngularPolyWorker();                    // every @AngularIsland
export const worker = defineAngularPolyWorker({ apps: [Counter, Notes] });      // named by stamp/class
export const worker = defineAngularPolyWorker({ apps: { counter: Counter } });  // explicit keys
export const worker = defineAngularMonoWorker(CounterComponent);                // 1:1 instance worker
// per-app DI: { counter: { component: Counter, providers: [...] } }
```

## Requirements & limits

- **`import '@angular/compiler'` in the worker entry for JIT (decorator)
  components** — missing it throws a named error at mount. AOT/`ɵcmp`
  components need nothing; the worker bundle stays compiler-free.
- `input()`/`model()`/`output()` fields on JIT components work through the
  adapter's signal-member interop, but **`input({alias})` aliases aren't
  discoverable** — bind by field name, or use AOT.
- The Sanitizer is **passthrough** — worker output is not sanitized.
- `@defer` with `on immediate` works; interaction/viewport/idle triggers are
  untested (no real viewport/hover events exist worker-side). Forms and
  animations are unexplored.
- Props must be `structuredClone`-able — `mountIsland` rejects uncloneable
  values naming the offending key.

## Documentation

- [Atoll — package documentation](https://jwhenry3.github.io/atolljs/consumer/quickstart/)
- [Worker islands for Angular](https://jwhenry3.github.io/atolljs/consumer/fw-angular/worker-islands/)
- [Worker islands](https://jwhenry3.github.io/atolljs/consumer/islands/) —
  `mountIsland` options, `IslandHandle`, island rules
- In-repo internals: [`docs/islands.md`](../../docs/islands.md),
  [`docs/islands-worker.md`](../../docs/islands-worker.md)
