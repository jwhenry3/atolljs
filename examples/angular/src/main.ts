import { provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideAtoll } from '@atolljs/angular';
import { initDevtools } from '@atolljs/devtools';
import { incidents } from '@atolljs/incidents';
import { AppComponent } from './app.component';

// Instrument before the pool's first task call — the sink must be installed
// when workers spawn for their events to forward over the task channel.
// ng serve doesn't host /__atoll/, so this app streams to the standalone
// aggregate dashboard instead (npx atoll-devtools → http://127.0.0.1:4780).
// No-op unless the URL carries ?__atoll_devtools.
initDevtools({
  session: { name: 'incidents-angular' },
  overlay: false,
  url: 'ws://127.0.0.1:4780/events',
});

bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    // The domain package owns the typed worker client; provideAtoll registers
    // it for DI and terminates it on app teardown/HMR (it re-spawns lazily).
    provideAtoll({ pools: [{ name: 'incidents', client: incidents }] }),
  ],
}).catch(console.error);
