# @jwhenry123/mesh-angular-island

The Angular shell surface for `@jwhenry123/mesh-islands` — mount a
worker-hosted tree as an ordinary element in a main-thread Angular app —
plus the Angular **worker renderer**: `angularIslandApp` bootstraps a
standalone component via `createComponent` against a `Renderer2`/
`RendererFactory2` bound to the instance's proxy document (the same
abstraction platform-server uses), so every render call serializes to the
op stream the shell replays as real DOM.

```bash
npm install @jwhenry123/mesh @jwhenry123/mesh-islands @jwhenry123/mesh-angular-island @angular/core @angular/common
```

## `<mesh-island>` / `[meshIsland]`

```ts
import { Component } from '@angular/core';
import { MeshIslandComponent } from '@jwhenry123/mesh-angular-island';
import { connectIslandWorker } from '@jwhenry123/mesh-islands';

const renderWorker = () =>
  new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });

@Component({
  standalone: true,
  imports: [MeshIslandComponent],   // or MeshIslandModule for NgModule apps
  template: `
    <mesh-island
      [client]="client"
      app="charts"
      [props]="{ width: width }"
      (ready)="onReady($event)"
      (error)="onError($event)"
      [onEvent]="onIslandEvent"
      class="island-box" />
  `,
})
export class ShellComponent {
  client = connectIslandWorker({ worker: renderWorker });  // shareable across islands
  width = 640;
  onIslandEvent = (name: string, payload: unknown) => { ... };
  onReady(h: IslandHandle) {}
  onError(e: unknown) {}
}
```

`[meshIsland]` is the directive form for existing elements; `client` can
be shared across several islands in one worker. All the
[islands island rules](../islands/README.md#island-rules) apply
unchanged.

## The worker renderer: `angularIslandApp` / `defineAngularPolyWorker`

```ts
// counter.worker.ts — the whole worker entry
import '@angular/compiler';                     // JIT decorator components only
import { Component, signal } from '@angular/core';
import { defineAngularPolyWorker, emit } from '@jwhenry123/mesh-angular-island/worker';

@Component({
  standalone: true,
  selector: 'mesh-counter',
  template: `<button (click)="inc()">{{ label() }}: {{ n() }}</button>`,
})
class CounterComponent {
  readonly label = input('count');
  readonly n = signal(0);
  inc() { this.n.update((v) => v + 1); emit('bumped', this.n()); }
}

export const worker = defineAngularPolyWorker({
  apps: { counter: CounterComponent },
  // per-app DI: { counter: { component: CounterComponent, providers: [...] } }
});
// or a 1:1 instance worker: defineAngularMonoWorker(CounterComponent)
```

Semantics: `mount` creates the component in a bare environment injector
(`providedIn: 'root'` services and `options.providers` resolve); change
detection is zoneless — every dispatched listener and `setInput` ends in a
synchronous `detectChanges` plus the `AfterRenderManager` pass, so
`afterRenderEffect`/`effect()` run, and signal writes from timers/promise
continuations queue a microtask tick inside the instance. `emit`/`runInInstance`
are re-exported for the island→shell channel.

## Requirements & limits

- **`import '@angular/compiler'` in the worker entry for JIT (decorator)
  components** — missing it throws a named error at mount. AOT/`ɵcmp`
  components (real `ngc` output, or hand-written defs) need nothing — the
  worker bundle stays compiler-free.
- `input()`/`model()`/`output()` fields on JIT components work through the
  adapter's signal-member interop (bindings, transforms, `ngOnChanges`),
  but **`input({alias})` aliases aren't discoverable** — bind by field
  name, or use AOT.
- The Sanitizer is **passthrough** — worker output is not sanitized.
- `@defer` with `on immediate` works; interaction/viewport/idle triggers
  are untested (no real viewport/hover events exist worker-side).
- Forms (`ngModel`) and animations (no driver) are unexplored.
- `structuredClone`-able props (they cross `postMessage`; `mountIsland`
  rejects uncloneable values naming the offending key).
