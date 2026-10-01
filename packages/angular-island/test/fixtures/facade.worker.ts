/**
 * Island worker entry for the facade tests — `@AngularIsland`-decorated
 * components exercising the decorator's three jobs: `islandAppName`
 * stamping (shell `[app]` accepts the class), module-level registration
 * (the no-arg `defineAngularPolyWorker()` collects them), and
 * root-output → emit bridging (the component's `output()`/`model()`
 * fields ARE the island's event vocabulary).
 *
 * `import '@angular/compiler'` installs the JIT facade — the components are
 * decorator-authored, so `ɵcmp` compiles lazily. (The shell-side generated
 * facade component needs no compiler — its `ɵcmp` is hand-authored.)
 */
import '@angular/compiler';
import { Component, input, model, output } from '@angular/core';
import { z } from '@atolljs/core';
import {
  AngularIsland,
  defineAngularPolyWorker,
} from '../../src/worker';
import { defineIslandContract } from '@atolljs/islands/worker';

/**
 * Bare-decorator form — the registry name derives from the class name
 * (`GreetComponent` → 'greet'). Props inference on the shell comes from
 * `label`'s `InputSignal<string>` type.
 */
@AngularIsland
@Component({
  standalone: true,
  selector: 'atoll-greet',
  template: `<p class="greet">{{ label() }}</p>`,
})
export class GreetComponent {
  readonly label = input('hello');
}

/**
 * Explicit-name form plus an `output()` field — clicking the button emits
 * `save(amount)` on the component, which the adapter bridges to the
 * island's emit channel as event 'save'.
 */
@AngularIsland('saver-app')
@Component({
  standalone: true,
  selector: 'atoll-saver',
  template: `<button class="save-btn" (click)="save.emit(amount())">save</button>`,
})
export class SaverComponent {
  readonly amount = input(0);
  readonly save = output<number>();
}

/**
 * A `model()` field — its write is an input AND an output ('voteChange'),
 * so a click produces a bridged 'voteChange' island event.
 */
@AngularIsland
@Component({
  standalone: true,
  selector: 'atoll-voter',
  template: `<button class="vote-btn" (click)="vote.set(vote() + 1)">vote {{ vote() }}</button>`,
})
export class VoterComponent {
  readonly vote = model(0);
}

/** Not decorated — only reachable via the explicit `apps` array form. */
@Component({
  standalone: true,
  selector: 'atoll-plain-echo',
  template: `<p class="plain">{{ text() }}</p>`,
})
export class PlainEchoComponent {
  readonly text = input('x');
}

/**
 * Contracted component — `@AngularIsland({ contract })` stamps the wire
 * schema onto the registry entry: props parse at mount/updateProps, and
 * the `paid` output's bridged emit validates its payload.
 */
export const contractedContract = defineIslandContract({
  app: 'contracted',
  props: z.object({ price: z.number() }),
  events: { paid: z.object({ total: z.number() }) },
});

@AngularIsland({ name: 'contracted', contract: contractedContract })
@Component({
  standalone: true,
  selector: 'atoll-contracted',
  template: `<button class="pay-btn" (click)="paid.emit({ total: price() })">pay</button>`,
})
export class ContractedComponent {
  readonly price = input(0);
  readonly paid = output<{ total: number }>();
}

// No-arg form: collects every @AngularIsland-decorated component above.
export const facadeWorker = defineAngularPolyWorker();

// Array form: names resolve from the stamp or the kebab-cased class name
// (`PlainEchoComponent` → 'plain-echo') — no decorator required.
export const facadeArrayWorker = defineAngularPolyWorker({
  apps: [PlainEchoComponent],
});
