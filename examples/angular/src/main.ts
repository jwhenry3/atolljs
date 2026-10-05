import { provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideAtoll } from '@atolljs/angular';
import { initDevtools } from '@atolljs/devtools';
import { incidents } from '@atolljs/incidents';
import { AppComponent } from './app.component';

// Instrument before the pool's first task call — the sink must be installed
// when workers spawn for their events to forward over the task channel.
// No-op unless the URL carries ?__atoll_devtools.
//
// Under ng serve (:4201) this app streams to the standalone aggregate
// dashboard instead — ng serve doesn't host /__atoll/, so the flyout has
// nothing to iframe (npx atoll-devtools → http://127.0.0.1:4780, which
// dev:all also runs). Everywhere else — including the built docs demo
// tree, which mounts __atoll/ inside this app's own folder — the browser
// broadcast transport + overlay apply.
initDevtools(
  location.port === '4201'
    ? {
        session: { name: 'incidents-angular', framework: 'angular' },
        overlay: false,
        url: 'ws://127.0.0.1:4780/events',
      }
    : {
        session: { name: 'incidents-angular', framework: 'angular' },
        // Relative dashboard path — mounted hosts ship __atoll/ inside the
        // app's own folder; absolute /__atoll/ would escape a sub-path mount.
        overlay: { src: '__atoll/?mini=1' },
      },
);

bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    // The domain package owns the typed worker client; provideAtoll registers
    // it for DI and terminates it on app teardown/HMR (it re-spawns lazily).
    provideAtoll({ pools: [{ name: 'incidents', client: incidents }] }),
  ],
}).catch(console.error);
