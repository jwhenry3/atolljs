# Angular — `@atolljs/angular` + `@atolljs/angular-island`

Read when: working on `packages/angular/` (binding) or
`packages/angular-island/` (shell + worker renderer for Angular islands).

## Binding — `@atolljs/angular`

Signal adapter for zoneless Angular. Call in an injection context (field
initializer or constructor) so subscriptions release on destroy. NgModule apps
get the same pools through `AtollModule` — the NestJS binding's
`forRoot`/`registerPool` vocabulary. Source: `packages/angular/src/index.ts`.
Example: `examples/angular/src/app.component.ts` + `.html`.

| Export | Signature | What it does |
|---|---|---|
| `provideAtoll` | `provideAtoll({ pools: AtollPoolDeclaration[] }, ...features)` | Register worker pools or `connectWorker` clients (`{ name, client }`) as environment providers — terminated on injector destroy; also usable at route level. |
| `injectAtollPool` | `injectAtollPool<T>(name): T` | Inject a pool registered by `provideAtoll` inside an injection context; mockable via TestBed. |
| `AtollModule` | `AtollModule.forRoot({pools?})` / `forRootAsync` / `registerPool(decl)` / `registerPoolAsync` | NgModule alternative to `provideAtoll` — same pool tokens + lifecycle, declared on the importing module; async forms resolve their factory before bootstrap. |
| `@InjectAtollPool` | `@InjectAtollPool(name)` | Constructor-parameter decorator form of `injectAtollPool` for `@Injectable()` classes. |
| `observableSignal` | `observableSignal(source: ObservableValue<T>): Signal<T>` | Subscribe to any observable snapshot (task or field). |
| `sharedValue` | `sharedValue(memory, key, select?, options?): Signal<T \| undefined>` | Bind one shared-memory field to a Signal; optional selector + equality. |
| `taskState` | `taskState(task \| asyncFn): { state: Signal<TaskSnapshot>, run, runOnce }` | Bind an AsyncTask — or any async fn — to a Signal and get its triggers. |

NgModule form — `AtollModule` (from the docs' moduleSnippet):

```ts
@NgModule({
  imports: [
    AtollModule.forRoot(),       // or forRoot({ pools: [{ name: 'incidents', client: incidents }] })
    IncidentsModule,            // imports AtollModule.registerPool({ name: 'incidents', client: incidents })
  ],
})
export class AppModule {}

@Injectable()
export class IncidentsService {
  // parameter-decorator form of injectAtollPool
  constructor(@InjectAtollPool('incidents') private readonly pool: IncidentsClient) {}
}
```

Works with OnPush + zoneless change detection out of the box.

## Worker islands — `@atolljs/angular-island`

Shell components that mount a worker-hosted tree in an Angular app, plus the
Angular **worker renderer**: `angularIslandApp` bootstraps a standalone
component via `createComponent` against a `Renderer2`/`RendererFactory2` bound
to the instance's proxy document (the same abstraction platform-server uses).

### Shell surface

| Export | Signature | What it does |
|---|---|---|
| `AtollIslandComponent` | `<atoll-island [client\|worker] app [props] [onEvent] [slots] (ready) (error) />` | Standalone component — renders the island container; inputs forward to `mountIsland`, outputs report lifecycle. |
| `AtollIslandDirective` | `<div atollIsland [client\|worker] app … />` | Directive form for elements you already render. |
| `AtollIslandModule` | `imports: [AtollIslandModule]` | NgModule re-export of the standalone pair. |

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
}
```

### Worker renderer

| Export | Signature | What it does |
|---|---|---|
| `defineAngularPolyWorker` | `defineAngularPolyWorker({ apps: { name: Component \| { component, providers } } })` | Registry worker — components wrapped automatically; per-app DI providers supported. |
| `defineAngularMonoWorker` | `defineAngularMonoWorker(Component, options?)` | 1:1 instance worker — mounted namelessly. |
| `angularIslandApp` / `angularIsland` | `angularIslandApp(Component, { providers? }): RenderedIslandApp` | The adapter — mounts in a bare environment injector; `providedIn: 'root'` services and `options.providers` resolve. |
| `emit` / `runInInstance` | re-exported | The worker entry needs no direct islands import. |

```ts
// counter.worker.ts — the whole worker entry
import '@angular/compiler';                     // JIT decorator components only
import { Component, input, signal } from '@angular/core';
import { defineAngularPolyWorker, emit } from '@atolljs/angular-island/worker';

@Component({
  standalone: true,
  selector: 'atoll-counter',
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
```

### Semantics & limits

- `mount` creates the component in a bare environment injector
  (`providedIn: 'root'` services and `options.providers` resolve); change
  detection is zoneless — every dispatched listener and `setInput` ends in a
  synchronous `detectChanges` plus the `AfterRenderManager` pass, so
  `afterRenderEffect`/`effect()` run, and signal writes from timers/promise
  continuations queue a microtask tick inside the instance.
- **`import '@angular/compiler'` in the worker entry for JIT (decorator)
  components** — missing it throws a named error at mount. AOT/`ɵcmp`
  components (real `ngc` output, or hand-written defs) need nothing — the
  worker bundle stays compiler-free.
- `input()`/`model()`/`output()` fields on JIT components work through the
  adapter's signal-member interop (bindings, transforms, `ngOnChanges`), but
  **`input({ alias })` aliases aren't discoverable** — bind by field name, or
  use AOT.
- The Sanitizer is **passthrough** — worker output is not sanitized.
- `@defer` with `on immediate` works; interaction/viewport/idle triggers are
  untested (no real viewport/hover events exist worker-side). Forms
  (`ngModel`) and animations (no driver) are unexplored.
- `structuredClone`-able props (they cross `postMessage`; `mountIsland`
  rejects uncloneable values naming the offending key).
