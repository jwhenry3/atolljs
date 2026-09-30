/**
 * Mono-worker fixture: `defineAngularMonoWorker` registers a single app under
 * the 'main' key so a nameless mount resolves it, and `angularIsland`
 * (the stamped-standalone helper) is exercised alongside it by registering a
 * stamped entry through the islands-level poly registry — they share this
 * worker's registry in-process.
 */
import '@angular/compiler';
import { Component, input } from '@angular/core';
import { definePolyWorker } from '@atolljs/islands/worker';
import { angularIsland, defineAngularMonoWorker } from '../../src/worker';

@Component({
  standalone: true,
  selector: 'atoll-mono',
  template: `<p class="mono-label">mono:{{ label() }}</p>`,
})
class MonoComponent {
  readonly label = input<string>('main');
}

export const monoStamped = angularIsland('ngMono', MonoComponent);

// The stamped app's registry contribution (union-merged into this worker).
export const stampedRegistry = definePolyWorker({
  apps: { ngMono: monoStamped },
});

export const monoWorker = defineAngularMonoWorker(MonoComponent);
