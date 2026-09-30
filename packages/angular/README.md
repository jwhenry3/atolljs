# @atolljs/angular

[![CI](https://github.com/jwhenry3/atolljs/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/jwhenry3/atolljs/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/jwhenry3/atolljs/graph/badge.svg?branch=main)](https://codecov.io/gh/jwhenry3/atolljs)
[![Socket Badge](https://badge.socket.dev/npm/package/@atolljs/angular)](https://badge.socket.dev/npm/package/@atolljs/angular)

Angular bindings for `@atolljs/core` — shared-memory fields and worker tasks as
`Signal`s, plus DI registration for pools/clients. Zoneless-friendly; call the
signal factories in an injection context (field initializer or constructor) so
subscriptions release on destroy.

**[Atoll — package documentation](https://jwhenry3.github.io/atolljs/consumer/quickstart/)**

## Install

```bash
npm install @atolljs/core @atolljs/angular
```

## Usage

```ts
// main.ts — register the connectWorker client as a DI provider,
// terminated on app teardown (it re-spawns lazily on the next call)
bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    provideAtoll({ pools: [{ name: 'counter', client: counter }] }),
  ],
});
```

```ts
// app.component.ts
import { Component, effect } from '@angular/core';
import { injectAtollPool, sharedValue, taskState } from '@atolljs/angular';
import { counterMemory } from './counter.memory';
import { counter } from './counter';

@Component({
  selector: 'app-root',
  template: `<button (click)="increment.run(1)">
    count: {{ count() ?? '…' }}</button>`,
})
export class AppComponent {
  private readonly counter = injectAtollPool<typeof counter>('counter');
  count = sharedValue(counterMemory, 'count');
  increment = taskState(this.counter.increment);

  constructor() {
    effect(() => console.log('count →', this.count()));
  }
}
```

## API

- `provideAtoll({ pools }, ...features)` — register worker pools or
  `connectWorker` clients (`{ name, client }`) as environment providers;
  usable at app or route level.
- `injectAtollPool(name)` — inject a registered pool inside an injection
  context; mockable via `TestBed`.
- `AtollModule.forRoot / forRootAsync / registerPool / registerPoolAsync` —
  NgModule alternative with the same pool tokens + lifecycle.
- `@InjectAtollPool(name)` — constructor-parameter decorator form for
  `@Injectable()` classes.
- `observableSignal(source)` — subscribe to any `ObservableValue` snapshot as
  a `Signal`.
- `sharedValue(memory, key, select?, options?)` — bind one shared-memory field
  to a `Signal`; optional selector + `equals`.
- `taskState(task | asyncFn)` — bind an `AsyncTask` (or any async fn) to
  `{ state: Signal<TaskSnapshot> }` plus `run`/`runOnce` triggers.

## Notes

- Works with `OnPush` + zoneless change detection out of the box.
- Worker-hosted Angular trees (islands) live in the companion package
  [`@atolljs/angular-island`](../angular-island).

## Documentation

- [Atoll — package documentation](https://jwhenry3.github.io/atolljs/consumer/quickstart/)
- [Angular guide](https://jwhenry3.github.io/atolljs/consumer/fw-angular/)
- [Worker islands for Angular](https://jwhenry3.github.io/atolljs/consumer/fw-angular/worker-islands/)
